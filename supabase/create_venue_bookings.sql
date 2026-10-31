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
    setup_minutes integer not null default 0 check (setup_minutes >= 0 and setup_minutes <= 1440),
    turnaround_minutes integer not null default 0 check (turnaround_minutes >= 0 and turnaround_minutes <= 1440),
    occupied_start timestamptz,
    occupied_end timestamptz,
    status text not null default 'Requested' check (status in ('Requested', 'Confirmed', 'Rejected', 'Blocked', 'Cancelled')),
    requested_by integer not null references public.app_users(id),
    requested_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    last_changed_by integer references public.app_users(id),
    last_changed_at timestamptz,
    decided_by integer references public.app_users(id),
    decision_at timestamptz,
    decision_reason text check (char_length(decision_reason) <= 2000),
    suggested_alternative text check (char_length(suggested_alternative) <= 2000),
    constraint venue_bookings_time_order check (end_at > start_at)
);

alter table public.venue_bookings
    add column if not exists suggested_alternative text
        check (char_length(suggested_alternative) <= 2000);
alter table public.venue_bookings
    add column if not exists updated_at timestamptz not null default now(),
    add column if not exists last_changed_by integer references public.app_users(id),
    add column if not exists last_changed_at timestamptz;

create index if not exists venue_bookings_requested_idx
    on public.venue_bookings (status, requested_at desc);
create index if not exists venue_bookings_event_idx
    on public.venue_bookings (event_id, requested_at desc);
create index if not exists venue_bookings_venue_idx
    on public.venue_bookings (venue_id, start_at, end_at);

-- Committed periods cannot overlap each other. Requested rows are tentative holds:
-- only one hold may exist per slot, while a later confirmed booking may supersede a hold.
alter table public.venue_bookings drop constraint if exists venue_bookings_no_overlap;
alter table public.venue_bookings drop constraint if exists venue_bookings_no_overlap_hard;
alter table public.venue_bookings drop constraint if exists venue_bookings_one_tentative_hold;
alter table public.venue_bookings add constraint venue_bookings_no_overlap_hard
    exclude using gist (
        venue_id with =,
        tstzrange(start_at - make_interval(mins => setup_minutes),
                  end_at + make_interval(mins => turnaround_minutes), '[)') with &&
    ) where (status in ('Confirmed', 'Blocked'));
alter table public.venue_bookings add constraint venue_bookings_one_tentative_hold
    exclude using gist (
        venue_id with =,
        tstzrange(start_at - make_interval(mins => setup_minutes),
                  end_at + make_interval(mins => turnaround_minutes), '[)') with &&
    ) where (status in ('Requested', 'Pending'));

alter table public.venue_bookings enable row level security;
revoke all on public.venue_bookings from anon, authenticated;
grant select, insert, update on public.venue_bookings to service_role;

create or replace function public.set_venue_booking_buffer_interval()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    venue_setup integer;
    venue_turnaround integer;
begin
    select setup_time_minutes, turnaround_time_minutes
      into venue_setup, venue_turnaround
      from public.venues
     where id = new.venue_id;
    new.setup_minutes := coalesce(venue_setup, 0);
    new.turnaround_minutes := coalesce(venue_turnaround, 0);
    new.occupied_start := new.start_at - make_interval(mins => new.setup_minutes);
    new.occupied_end := new.end_at + make_interval(mins => new.turnaround_minutes);
    return new;
end;
$$;

drop trigger if exists venue_bookings_set_buffer_interval on public.venue_bookings;
create trigger venue_bookings_set_buffer_interval
before insert or update of venue_id, start_at, end_at, status, setup_minutes, turnaround_minutes
on public.venue_bookings
for each row execute function public.set_venue_booking_buffer_interval();

create or replace function public.refresh_venue_booking_buffers()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    update public.venue_bookings
       set setup_minutes = new.setup_time_minutes,
           turnaround_minutes = new.turnaround_time_minutes
     where venue_id = new.id;
    return new;
end;
$$;

drop trigger if exists venues_refresh_booking_buffers on public.venues;
create trigger venues_refresh_booking_buffers
after update of setup_time_minutes, turnaround_time_minutes
on public.venues
for each row execute function public.refresh_venue_booking_buffers();

commit;