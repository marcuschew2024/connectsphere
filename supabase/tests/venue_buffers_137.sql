begin;

-- SCRUM-137 verifies that concurrent inserts cannot both occupy the same
-- setup/turnaround-expanded interval.
do $$
declare
    venue_id uuid := gen_random_uuid();
    event_a uuid := gen_random_uuid();
    event_b uuid := gen_random_uuid();
begin
    insert into public.venues (
        id, reference, name, location, capacity, supported_layouts,
        facilities, accessibility, operating_hours, setup_time_minutes,
        turnaround_time_minutes
    ) values (
        venue_id, 'SCRUM137-' || venue_id::text, 'SCRUM 137 Venue', 'Test',
        100, array['Theatre'], '{}'::text[], '{}'::text[], '{}'::jsonb, 30, 30
    );

    insert into public.events (
        id, title, description, purpose, category, event_datetime,
        expected_attendance, status, organiser_id, coordinator_id, submitted_at
    ) values
        (event_a, 'SCRUM-137 A', 'Test', 'Test buffer overlap', 'Workshop',
         '2099-10-20T06:00:00Z', 50, 'Planning', 1, 2, now()),
        (event_b, 'SCRUM-137 B', 'Test', 'Test buffer overlap', 'Workshop',
         '2099-10-20T06:00:00Z', 50, 'Planning', 1, 2, now());

    insert into public.venue_bookings (
        event_id, venue_id, start_at, end_at, expected_attendance, layout, requested_by, status
    ) values (
        event_a, venue_id, '2099-10-20T06:00:00Z',
        '2099-10-20T07:00:00Z', 50, 'Theatre', 2, 'Confirmed'
    );

    begin
        insert into public.venue_bookings (
            event_id, venue_id, start_at, end_at, expected_attendance, layout, requested_by, status
        ) values (
            event_b, venue_id,
            '2099-10-20T08:00:00Z',
            '2099-10-20T09:00:00Z',
            50, 'Theatre', 2, 'Confirmed'
        );
        raise exception 'SCRUM-137 buffered overlap was not rejected';
    exception when exclusion_violation then
        null;
    end;
end;
$$;

rollback;
