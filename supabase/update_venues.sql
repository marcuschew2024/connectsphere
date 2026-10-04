-- SCRUM-25. Run after create_venues.sql. Safe to rerun.
begin;
alter table public.venues add column if not exists revision integer not null default 1;
alter table public.venues add column if not exists updated_at timestamptz;

create table if not exists public.venue_update_history (
    id uuid primary key default gen_random_uuid(),
    venue_id uuid not null references public.venues(id) on delete cascade,
    actor_id integer not null references public.app_users(id),
    changed_at timestamptz not null default now(),
    before_details jsonb not null,
    after_details jsonb not null
);
create index if not exists venue_update_history_venue_idx
    on public.venue_update_history (venue_id, changed_at desc);
alter table public.venue_update_history enable row level security;
revoke all on public.venue_update_history from anon, authenticated, service_role;
grant select on public.venue_update_history to service_role;

create or replace function public.update_venue_details(
    p_venue_id uuid, p_details jsonb, p_actor_id integer, p_revision integer
) returns setof public.venues
language plpgsql security definer set search_path = '' as $$
declare
    previous public.venues;
    saved public.venues;
begin
    if not exists (select 1 from public.app_users where id = p_actor_id and role = 'Venue Staff') then
        raise sqlstate 'PT403' using message = 'Venue Staff required';
    end if;
    select * into previous from public.venues where id = p_venue_id for update;
    if not found then raise sqlstate 'PT404' using message = 'Venue not found'; end if;
    if p_revision is distinct from previous.revision then
        raise sqlstate 'PT409' using message = 'Venue changed since it was loaded';
    end if;
    if jsonb_typeof(p_details) is distinct from 'object'
        or not (p_details ?& array['capacity','facilities','accessibility','supported_layouts','operating_hours'])
        or (select count(*) from jsonb_object_keys(p_details)) <> 5 then
        raise sqlstate '22023' using message = 'Invalid venue fields';
    end if;
    -- Existing table constraints also enforce positive capacity, valid hours and features.
    update public.venues set
        capacity = (p_details->>'capacity')::integer,
        facilities = array(select jsonb_array_elements_text(p_details->'facilities')),
        accessibility = array(select jsonb_array_elements_text(p_details->'accessibility')),
        supported_layouts = array(select jsonb_array_elements_text(p_details->'supported_layouts')),
        operating_hours = p_details->'operating_hours',
        revision = revision + 1, updated_at = now()
    where id = p_venue_id returning * into saved;
    insert into public.venue_update_history (venue_id, actor_id, changed_at, before_details, after_details)
        values (p_venue_id, p_actor_id, saved.updated_at, to_jsonb(previous), to_jsonb(saved));
    return next saved;
end;
$$;
revoke all on function public.update_venue_details(uuid, jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.update_venue_details(uuid, jsonb, integer, integer) to service_role;
notify pgrst, 'reload schema';
commit;
