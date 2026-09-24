-- SCRUM-17: assign each submitted request to one Coordinator.
-- Run seed_users.sql and create_events.sql first. Safe to rerun.
begin;

alter table public.events
    add column if not exists coordinator_assigned_at timestamptz;

-- Existing submitted rows are assigned before the invariant is installed.
update public.events
set coordinator_id = coalesce(
        coordinator_id,
        (
            select id
            from public.app_users
            where role = 'Coordinator'
            order by id
            limit 1
        )
        ),
    coordinator_assigned_at = coalesce(coordinator_assigned_at, now())
where status <> 'Draft'
    and (coordinator_id is null or coordinator_assigned_at is null);

create or replace function public.assign_event_coordinator()
returns trigger language plpgsql set search_path = '' as $$
begin
    if new.status <> 'Draft' then
        if new.coordinator_id is null then
            select id
            into new.coordinator_id
            from public.app_users
            where role = 'Coordinator'
            order by id
            limit 1;

            if new.coordinator_id is null then
                raise exception 'No Coordinator is available to assign this request';
            end if;
        end if;

        new.coordinator_assigned_at = coalesce(new.coordinator_assigned_at, now());
    end if;

    return new;
end;
$$;

drop trigger if exists events_assign_coordinator on public.events;
create trigger events_assign_coordinator
    before insert or update of status on public.events
    for each row execute function public.assign_event_coordinator();

alter table public.events drop constraint if exists events_submitted_assignment_check;
alter table public.events add constraint events_submitted_assignment_check check (
    status = 'Draft' or (
        coordinator_id is not null
        and coordinator_assigned_at is not null
    )
);

create index if not exists events_coordinator_queue_idx
    on public.events (coordinator_id, status, updated_at desc);

commit;
