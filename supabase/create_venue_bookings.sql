-- SCRUM-31: coordinator venue booking requests. Run after create_events.sql and create_venues.sql.
begin;

create extension if not exists btree_gist;

create table if not exists public.venue_bookings (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null references public.events(id) on delete cascade,
    venue_id uuid not null references public.venues(id),
    start_at timestamptz not null,
    end_at timestamptz not null,
    expected_attendance integer not null check (expected_attendance > 0),
    layout text not null check (char_length(btrim(layout)) between 1 and 100),
    special_requirements text check (char_length(special_requirements) <= 2000),
    status text not null default 'Requested' check (status in ('Requested', 'Confirmed', 'Rejected', 'Blocked', 'Cancelled')),
    requested_by integer not null references public.app_users(id),
    requested_at timestamptz not null default now(),
    decided_by integer references public.app_users(id),
    decision_at timestamptz,
    decision_reason text check (char_length(decision_reason) <= 2000),
    constraint venue_bookings_time_order check (end_at > start_at)
);

create index if not exists venue_bookings_requested_idx
    on public.venue_bookings (status, requested_at desc);
create index if not exists venue_bookings_event_idx
    on public.venue_bookings (event_id, requested_at desc);
create index if not exists venue_bookings_venue_idx
    on public.venue_bookings (venue_id, start_at, end_at);

-- Confirmed and blocked periods cannot overlap. Requested rows remain reviewable;
-- the API prevents requests against an already confirmed/blocked period.
alter table public.venue_bookings drop constraint if exists venue_bookings_no_overlap;
alter table public.venue_bookings add constraint venue_bookings_no_overlap
    exclude using gist (
        venue_id with =,
        tstzrange(start_at, end_at, '[)') with &&
    ) where (status in ('Confirmed', 'Blocked'));

alter table public.venue_bookings enable row level security;
revoke all on public.venue_bookings from anon, authenticated;
grant select, insert, update on public.venue_bookings to service_role;

commit;