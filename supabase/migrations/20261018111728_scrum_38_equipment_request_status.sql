-- SCRUM-38: apply after create_equipment_requests.sql. Safe to rerun.
-- Status reports arrangements; stock remains owned by SCRUM-36/37.
begin;
alter table public.equipment_requests
    drop constraint if exists equipment_requests_status_check;
alter table public.equipment_requests
    add constraint equipment_requests_status_check
    check (status in ('Requested', 'Reserved', 'Partially fulfilled', 'Unavailable'));
alter table public.equipment_requests
    add column if not exists revision integer not null default 1 check (revision > 0),
    add column if not exists update_notes text not null default '' check (length(update_notes) <= 2000),
    add column if not exists updated_by integer references public.app_users(id),
    add column if not exists updated_at timestamptz;

create table if not exists public.equipment_request_history (
    request_id uuid not null references public.equipment_requests(id) on delete cascade,
    revision integer not null check (revision > 1),
    from_status text not null check (from_status in ('Requested', 'Reserved', 'Partially fulfilled', 'Unavailable')),
    status text not null check (status in ('Requested', 'Reserved', 'Partially fulfilled', 'Unavailable')),
    notes text not null check (length(notes) <= 2000),
    actor_id integer not null references public.app_users(id),
    actor_name text not null,
    changed_at timestamptz not null,
    primary key (request_id, revision)
);
create index if not exists equipment_request_history_actor
    on public.equipment_request_history(actor_id);
create index if not exists equipment_requests_updater
    on public.equipment_requests(updated_by);
alter table public.equipment_request_history enable row level security;
revoke all on public.equipment_request_history from anon, authenticated, service_role;
grant select on public.equipment_request_history to service_role;

-- Follow the existing backend-only audited RPC contract: no direct status/audit writes.
-- Flask derives p_actor_id from its app session (these are not Supabase Auth identities).
create or replace function public.update_equipment_request_status(
    p_request_id uuid, p_status text, p_notes text, p_revision integer, p_actor_id integer
) returns setof public.equipment_requests
language plpgsql security definer set search_path = '' as $$
declare
    actor public.app_users;
    event_id uuid;
    event_status text;
    previous public.equipment_requests;
    saved public.equipment_requests;
begin
    select * into actor from public.app_users
    where id = p_actor_id and role = 'Tech Support' for share;
    if not found then raise sqlstate 'PT403' using message = 'Tech Support required'; end if;
    if p_status is null or p_status not in ('Requested', 'Reserved', 'Partially fulfilled', 'Unavailable')
        or p_notes is null or length(btrim(p_notes)) > 2000
        or p_revision is null or p_revision < 1 then
        raise sqlstate '22023' using message = 'Invalid status update';
    end if;
    select r.event_id into event_id from public.equipment_requests r where r.id = p_request_id;
    if not found then raise sqlstate 'PT404' using message = 'Request not found'; end if;
    -- Lock the event before the request, keeping lifecycle changes outside this transaction.
    select e.status into event_status from public.events e where e.id = event_id for share;
    if event_status in ('Cancelled', 'Completed', 'Rejected') then
        raise sqlstate 'PT409' using message = 'closed_event';
    end if;
    select * into previous from public.equipment_requests where id = p_request_id for update;
    if not found then raise sqlstate 'PT404' using message = 'Request not found'; end if;
    if p_revision <> previous.revision then
        raise sqlstate 'PT409' using message = 'stale_request';
    end if;
    if p_status = previous.status then
        raise sqlstate 'PT409' using message = 'unchanged_status';
    end if;
    update public.equipment_requests set
        status = p_status, update_notes = btrim(p_notes), revision = previous.revision + 1,
        updated_by = actor.id, updated_at = clock_timestamp()
    where id = p_request_id returning * into saved;
    insert into public.equipment_request_history (
        request_id, revision, from_status, status, notes, actor_id, actor_name, changed_at
    ) values (
        saved.id, saved.revision, previous.status, saved.status, saved.update_notes,
        actor.id, actor.display_name, saved.updated_at
    );
    return next saved;
end;
$$;
revoke all on function public.update_equipment_request_status(uuid, text, text, integer, integer)
    from public, anon, authenticated;
grant execute on function public.update_equipment_request_status(uuid, text, text, integer, integer)
    to service_role;
notify pgrst, 'reload schema';
commit;
