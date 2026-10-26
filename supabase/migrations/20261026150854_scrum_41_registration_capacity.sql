-- SCRUM-41: capacity is separate from expected attendance (the planning estimate).
-- Existing events retain a NULL capacity, which keeps registration closed.
-- Apply after create_events.sql and edit_planning.sql. Safe to rerun.
begin;

alter table public.events
    add column if not exists registration_capacity integer,
    add column if not exists registered_count integer not null default 0;

alter table public.events drop constraint if exists events_registration_capacity_check;
alter table public.events add constraint events_registration_capacity_check check (
    (registration_capacity is null or registration_capacity > 0)
    and registered_count >= 0
    and registered_count <= coalesce(registration_capacity, 0)
);

create table if not exists public.event_registrations (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null references public.events(id) on delete cascade,
    attendee_id integer not null references public.app_users(id),
    status text not null default 'Registered' check (status in ('Registered', 'Withdrawn')),
    registered_at timestamptz not null default clock_timestamp(),
    withdrawn_at timestamptz,
    unique (event_id, attendee_id),
    check ((status = 'Withdrawn') = (withdrawn_at is not null))
);
create index if not exists event_registrations_attendee_idx
    on public.event_registrations (attendee_id, registered_at desc);

-- Each insert/status change locks and updates the SAME event row. The increment
-- is conditional, so PostgreSQL rechecks the latest count after waiting for a
-- competing transaction; counting a stale snapshot can never oversell a place.
-- The table trigger protects direct backend writes as well as the RPC below.
create or replace function public.guard_registration_capacity()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
    target uuid;
    event public.events;
    taking_place boolean;
    releasing_place boolean;
begin
    if tg_op = 'DELETE' then target := old.event_id; else target := new.event_id; end if;
    if tg_op = 'UPDATE' then
        if new.id <> old.id or new.event_id <> old.event_id
            or new.attendee_id <> old.attendee_id then
            raise sqlstate '22023' using message = 'Registration identity is immutable';
        end if;
        if new.status = old.status then
            new.registered_at := old.registered_at;
            new.withdrawn_at := old.withdrawn_at;
            return new;
        end if;
    end if;
    select * into event from public.events where id = target for update;
    if not found then
        -- A cascading event deletion no longer has a parent to update.
        if tg_op = 'DELETE' then return old; end if;
        raise sqlstate 'PT404' using message = 'Event not found';
    end if;
    taking_place := tg_op <> 'DELETE' and new.status = 'Registered';
    if tg_op = 'INSERT' then
        releasing_place := false;
        if new.status <> 'Registered' then
            raise sqlstate '22023' using message = 'New registration must be Registered';
        end if;
    else
        releasing_place := old.status = 'Registered';
    end if;

    if taking_place then
        perform 1 from public.app_users where id = new.attendee_id and role = 'Attendee';
        if not found then raise sqlstate 'PT403' using message = 'Attendee required'; end if;
        if event.status <> 'Confirmed' then
            raise sqlstate 'PT409' using message = 'registration_closed';
        end if;
        if tg_op = 'INSERT' and exists (
            select 1 from public.event_registrations
            where event_id = target and attendee_id = new.attendee_id
        ) then
            raise sqlstate 'PT409' using message = 'already_registered';
        end if;
        if event.registration_capacity is null then
            raise sqlstate 'PT409' using message = 'capacity_not_set';
        end if;
        update public.events set registered_count = registered_count + 1
        where id = target and registered_count < registration_capacity;
        if not found then raise sqlstate 'PT409' using message = 'event_full'; end if;
        new.registered_at := clock_timestamp();
        new.withdrawn_at := null;
    elsif releasing_place then
        if tg_op = 'UPDATE' and event.status = 'Completed' then
            raise sqlstate 'PT409' using message = 'registration_closed';
        end if;
        update public.events set registered_count = registered_count - 1 where id = target;
        if tg_op = 'UPDATE' then new.withdrawn_at := clock_timestamp(); end if;
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
end;
$$;

create or replace trigger event_registrations_capacity_guard
    before insert or update or delete on public.event_registrations
    for each row execute function public.guard_registration_capacity();

create or replace function public.set_registration_capacity(
    p_event_id uuid, p_actor_id integer, p_capacity integer
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare event public.events;
begin
    if p_capacity is null or p_capacity < 1 then
        raise sqlstate '22023' using message = 'Invalid capacity';
    end if;
    perform 1 from public.app_users where id = p_actor_id and role = 'Organiser';
    if not found then raise sqlstate 'PT403' using message = 'Organiser required'; end if;
    select * into event from public.events where id = p_event_id for update;
    if not found then raise sqlstate 'PT404' using message = 'Event not found'; end if;
    if event.organiser_id <> p_actor_id then
        raise sqlstate 'PT403' using message = 'Event owner required';
    end if;
    if event.status not in ('Draft', 'Submitted', 'Assigned', 'Under review', 'Approved', 'Planning') then
        raise sqlstate 'PT409' using message = 'capacity_locked';
    end if;
    if p_capacity < event.registered_count then
        raise sqlstate 'PT409' using message = 'capacity_below_registrations';
    end if;
    if event.registration_capacity is distinct from p_capacity then
        update public.events set registration_capacity = p_capacity
        where id = p_event_id returning * into event;
        insert into public.event_edit_log (event_id, editor_id, changed_fields, importance)
        values (p_event_id, p_actor_id, array['registration_capacity'], 'important');
    end if;
    return to_jsonb(event);
end;
$$;

create or replace function public.register_event_attendee(p_event_id uuid, p_attendee_id integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare registration public.event_registrations;
begin
    insert into public.event_registrations (event_id, attendee_id)
    values (p_event_id, p_attendee_id) returning * into registration;
    return to_jsonb(registration);
end;
$$;

alter table public.event_registrations enable row level security;
revoke all on public.event_registrations from public, anon, authenticated;
grant select, insert, update on public.event_registrations to service_role;
grant usage, select on sequence public.event_edit_log_id_seq to service_role;
revoke all on function public.guard_registration_capacity() from public, anon, authenticated;
revoke all on function public.set_registration_capacity(uuid, integer, integer)
    from public, anon, authenticated;
revoke all on function public.register_event_attendee(uuid, integer) from public, anon, authenticated;
grant execute on function public.set_registration_capacity(uuid, integer, integer) to service_role;
grant execute on function public.register_event_attendee(uuid, integer) to service_role;

notify pgrst, 'reload schema';
commit;
