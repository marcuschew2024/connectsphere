-- SCRUM-14: run seed_users.sql first, then this file in the Supabase SQL Editor.
-- Safe to rerun on this schema. Does not delete users or existing events.
begin;

create table if not exists public.events (
    -- Preserve the event UUID from the team's shared model.
    id uuid primary key default gen_random_uuid(),
    title text check (char_length(title) <= 200),
    description text check (char_length(description) <= 5000),
    purpose text check (char_length(purpose) <= 2000),
    category text check (char_length(category) <= 100),
    event_datetime timestamptz,
    expected_attendance integer check (expected_attendance > 0),
    venue_requirements text check (char_length(venue_requirements) <= 2000),
    accessibility_requirements text check (char_length(accessibility_requirements) <= 2000),
    equipment_requirements text check (char_length(equipment_requirements) <= 2000),
    registration_requirements text check (char_length(registration_requirements) <= 2000),
    status text not null default 'Draft' check (
        status in (
            'Draft', 'Submitted', 'Assigned', 'Under review', 'Approved',
            'Planning', 'Confirmed', 'Completed', 'Rejected', 'Cancelled'
        )
    ),
    -- Our app_users IDs are integers. These are NOT Supabase Auth IDs.
    organiser_id integer not null references public.app_users(id),
    coordinator_id integer references public.app_users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    submitted_at timestamptz,
    last_status_changed_by integer references public.app_users(id),
    last_status_changed_at timestamptz,

    -- Drafts may omit required fields; submitted requests must be complete.
    constraint events_complete_submission check (
        status = 'Draft' or (
            nullif(btrim(title), '') is not null
            and nullif(btrim(description), '') is not null
            and nullif(btrim(purpose), '') is not null
            and nullif(btrim(category), '') is not null
            and event_datetime is not null
            and expected_attendance is not null
            and submitted_at is not null
        )
    )
);

alter table public.events
    add column if not exists last_status_changed_by integer references public.app_users(id),
    add column if not exists last_status_changed_at timestamptz;

alter table public.events drop constraint if exists events_status_check;
alter table public.events add constraint events_status_check check (
    status in (
        'Draft', 'Submitted', 'Assigned', 'Under review', 'Approved',
        'Planning', 'Confirmed', 'Completed', 'Rejected', 'Cancelled'
    )
);

create index if not exists events_organiser_created_idx
    on public.events (organiser_id, created_at desc);
create index if not exists events_status_created_idx
    on public.events (status, created_at desc);

create table if not exists public.event_participants (
    event_id uuid not null references public.events(id) on delete cascade,
    user_id integer not null references public.app_users(id),
    role text not null,
    joined_at timestamptz not null default now(),
    primary key (event_id, user_id)
);

create index if not exists event_participants_user_idx
    on public.event_participants (user_id, joined_at desc);

create table if not exists public.event_status_history (
    id bigint generated always as identity primary key,
    event_id uuid not null references public.events(id) on delete cascade,
    old_status text,
    new_status text not null,
    changed_by integer not null references public.app_users(id),
    changed_at timestamptz not null default now()
);

create index if not exists event_status_history_event_idx
    on public.event_status_history (event_id, changed_at desc);

-- Preserve access and a starting history record for events created before these tables existed.
insert into public.event_participants (event_id, user_id, role)
select id, organiser_id, 'Organiser'
from public.events
on conflict (event_id, user_id) do nothing;

insert into public.event_participants (event_id, user_id, role)
select id, coordinator_id, 'Coordinator'
from public.events
where coordinator_id is not null
on conflict (event_id, user_id) do nothing;

insert into public.event_status_history (
    event_id, old_status, new_status, changed_by, changed_at
)
select
    event.id,
    null,
    event.status,
    coalesce(event.last_status_changed_by, event.organiser_id),
    coalesce(event.last_status_changed_at, event.created_at)
from public.events as event
where not exists (
    select 1
    from public.event_status_history as history
    where history.event_id = event.id
);

-- Future draft edits and coordinator updates also refresh updated_at.
create or replace function public.set_event_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create or replace trigger events_set_updated_at
    before update on public.events
    for each row execute function public.set_event_updated_at();

-- All event access goes through Flask, which enforces role and ownership rules.
alter table public.events enable row level security;
alter table public.event_participants enable row level security;
alter table public.event_status_history enable row level security;
revoke all on public.events from anon, authenticated;
revoke all on public.event_participants from anon, authenticated;
revoke all on public.event_status_history from anon, authenticated;
grant select, insert, update on public.events to service_role;
-- The existing participant upsert also needs UPDATE, even on a fresh insert.
grant select, insert, update on public.event_participants to service_role;
grant select, insert on public.event_status_history to service_role;

-- SCRUM-15: save an existing draft without creating another event.
-- Flask validates the fields and supplies the Organiser ID from its session.
-- A function makes the update and submission history succeed or roll back together.
create or replace function public.save_event_draft(
    p_event_id uuid,
    p_organiser_id integer,
    p_details jsonb,
    p_submit boolean default false
)
returns setof public.events
language plpgsql security invoker set search_path = '' as $$
declare
    saved public.events;
begin
    update public.events
    set title = p_details ->> 'title',
        description = p_details ->> 'description',
        purpose = p_details ->> 'purpose',
        category = p_details ->> 'category',
        event_datetime = (p_details ->> 'event_datetime')::timestamptz,
        expected_attendance = (p_details ->> 'expected_attendance')::integer,
        venue_requirements = p_details ->> 'venue_requirements',
        accessibility_requirements = p_details ->> 'accessibility_requirements',
        equipment_requirements = p_details ->> 'equipment_requirements',
        registration_requirements = p_details ->> 'registration_requirements',
        status = case when p_submit then 'Submitted' else 'Draft' end,
        submitted_at = case when p_submit then now() else null end,
        last_status_changed_by = case when p_submit then p_organiser_id
                                      else last_status_changed_by end,
        last_status_changed_at = case when p_submit then now()
                                      else last_status_changed_at end
    where id = p_event_id and organiser_id = p_organiser_id and status = 'Draft'
    returning * into saved;

    -- The Draft condition is checked while PostgreSQL locks the row. A second
    -- submit, or a save racing with submission, cannot edit a submitted request.
    if not found then
        return;
    end if;

    if p_submit then
        insert into public.event_status_history (event_id, old_status, new_status, changed_by)
        values (saved.id, 'Draft', 'Submitted', p_organiser_id);
    end if;
    return next saved;
end;
$$;

-- Only the backend may call this function. Browser users cannot supply an actor ID.
revoke all on function public.save_event_draft(uuid, integer, jsonb, boolean)
    from public, anon, authenticated;
grant execute on function public.save_event_draft(uuid, integer, jsonb, boolean) to service_role;
grant usage, select on sequence public.event_status_history_id_seq to service_role;

commit;
