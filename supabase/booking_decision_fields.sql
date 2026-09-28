-- SCRUM-32: booking-decision fields on Ernest's venue_bookings table (SCRUM-31).
-- decided_by / decision_at / decision_reason already exist in create_venue_bookings.sql;
-- this only adds the optional suggested-alternative a Venue Staff may give on reject
-- (TC-32-03). Run after create_venue_bookings.sql. Safe to rerun.
begin;

alter table public.venue_bookings
    add column if not exists suggested_alternative text
        check (char_length(suggested_alternative) <= 2000);

notify pgrst, 'reload schema';
commit;
