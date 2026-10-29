-- SCRUM-79: Tentatively hold a venue with expiry (Week 7 Customer Change #4).
-- Adds 'Held' and 'Expired' to venue_bookings status check, adds expires_at column,
-- and updates exclusion constraint to treat 'Held' and 'Requested' as tentative holds.

begin;

-- 1. Add expires_at column
alter table public.venue_bookings
    add column if not exists expires_at timestamptz;

-- 2. Expand status check to include 'Held' and 'Expired'
alter table public.venue_bookings drop constraint if exists venue_bookings_status_check;
alter table public.venue_bookings add constraint venue_bookings_status_check
    check (status in ('Requested', 'Pending', 'Held', 'Confirmed', 'Rejected', 'Blocked', 'Cancelled', 'Expired'));

-- 3. Update one_tentative_hold constraint to cover 'Held' as well as 'Requested' and 'Pending'
alter table public.venue_bookings drop constraint if exists venue_bookings_one_tentative_hold;
alter table public.venue_bookings add constraint venue_bookings_one_tentative_hold
    exclude using gist (
        venue_id with =,
        tstzrange(start_at, end_at, '[)') with &&
    ) where (status in ('Requested', 'Pending', 'Held'));

commit;
