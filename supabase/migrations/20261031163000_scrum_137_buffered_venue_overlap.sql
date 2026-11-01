-- SCRUM-137: make the database buffer-aware and preserve a report of legacy conflicts.
begin;

alter table public.venue_bookings
    add column if not exists setup_minutes integer not null default 0
        check (setup_minutes >= 0 and setup_minutes <= 1440),
    add column if not exists turnaround_minutes integer not null default 0
        check (turnaround_minutes >= 0 and turnaround_minutes <= 1440),
    add column if not exists occupied_start timestamptz,
    add column if not exists occupied_end timestamptz;

create table if not exists public.problematic_venue_bookings (
    venue_id uuid not null references public.venues(id),
    booking_id uuid not null references public.venue_bookings(id),
    conflicting_booking_id uuid not null references public.venue_bookings(id),
    detected_at timestamptz not null default now(),
    primary key (booking_id, conflicting_booking_id)
);

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
    update public.problematic_venue_bookings
       set detected_at = now()
     where venue_id = new.id;

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

update public.venue_bookings as booking
set setup_minutes = venue.setup_time_minutes,
    turnaround_minutes = venue.turnaround_time_minutes,
    occupied_start = booking.start_at - make_interval(mins => venue.setup_time_minutes),
    occupied_end = booking.end_at + make_interval(mins => venue.turnaround_time_minutes)
from public.venues as venue
where venue.id = booking.venue_id;

insert into public.problematic_venue_bookings (venue_id, booking_id, conflicting_booking_id)
select a.venue_id, least(a.id, b.id), greatest(a.id, b.id)
from public.venue_bookings a
join public.venue_bookings b
  on a.venue_id = b.venue_id
 and a.id < b.id
 and a.status in ('Confirmed', 'Blocked', 'Requested', 'Pending', 'Held')
 and b.status in ('Confirmed', 'Blocked', 'Requested', 'Pending', 'Held')
 and a.occupied_start < b.occupied_end
 and b.occupied_start < a.occupied_end
on conflict (booking_id, conflicting_booking_id) do nothing;

alter table public.problematic_venue_bookings enable row level security;
revoke all on public.problematic_venue_bookings from anon, authenticated;
grant select on public.problematic_venue_bookings to service_role;

-- Existing conflicts must be resolved by a human or migration remains blocked.
do $$
begin
    if exists (select 1 from public.problematic_venue_bookings) then
        raise exception 'SCRUM-137: existing buffered venue booking conflicts were recorded in problematic_venue_bookings';
    end if;
end;
$$;

alter table public.venue_bookings drop constraint if exists venue_bookings_no_overlap_hard;
alter table public.venue_bookings drop constraint if exists venue_bookings_one_tentative_hold;
alter table public.venue_bookings add constraint venue_bookings_no_overlap_hard
    exclude using gist (
        venue_id with =,
        tstzrange(occupied_start, occupied_end, '[)') with &&
    ) where (status in ('Confirmed', 'Blocked'));
alter table public.venue_bookings add constraint venue_bookings_one_tentative_hold
    exclude using gist (
        venue_id with =,
        tstzrange(occupied_start, occupied_end, '[)') with &&
    ) where (status in ('Requested', 'Pending', 'Held'));

notify pgrst, 'reload schema';
commit;
