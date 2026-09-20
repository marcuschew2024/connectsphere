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
        status in ('Draft', 'Submitted', 'Planning', 'Confirmed', 'Completed', 'Rejected', 'Cancelled')
    ),
    -- Our app_users IDs are integers. These are NOT Supabase Auth IDs.
    organiser_id integer not null references public.app_users(id),
    coordinator_id integer references public.app_users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    submitted_at timestamptz,

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

create index if not exists events_organiser_created_idx
    on public.events (organiser_id, created_at desc);
create index if not exists events_status_created_idx
    on public.events (status, created_at desc);

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
revoke all on public.events from anon, authenticated;
grant select, insert on public.events to service_role;

commit;
