-- SCRUM-79 tests: tentative venue holds and expiry constraints.
begin;

do $$
declare
    v_venue_id uuid := '79000000-0000-4000-8000-000000000001';
    v_event_id uuid := '79000000-0000-4000-8000-000000000002';
    v_booking_1 uuid := gen_random_uuid();
    v_booking_2 uuid := gen_random_uuid();
    v_start timestamptz := now() + interval '5 days';
    v_end timestamptz := now() + interval '5 days 2 hours';
    v_expires timestamptz := now() + interval '2 days';
begin
    -- Seed test venue and event self-contained within this transaction
    insert into public.venues (
        id, name, location, capacity, facilities, accessibility, supported_layouts,
        operating_hours, created_by
    ) values (
        v_venue_id, 'SCRUM-79 Hold Test Venue', 'Building C Room 101', 50,
        '{}', '{}', '{Classroom}',
        '{"monday":{"opens":"08:00","closes":"20:00"},"tuesday":null,"wednesday":null,"thursday":null,"friday":null,"saturday":null,"sunday":null}',
        3
    );

    insert into public.events (
        id, title, description, purpose, category, event_datetime, expected_attendance,
        status, organiser_id, coordinator_id, submitted_at
    ) values (
        v_event_id, 'SCRUM-79 Test Event', 'Test Description', 'Test Purpose', 'Workshop',
        v_start, 30, 'Planning', 1, 2, now()
    );

    -- 1. Insert a booking with status 'Held' and expires_at
    insert into public.venue_bookings (
        id, event_id, venue_id, start_at, end_at, expected_attendance, layout,
        status, requested_by, expires_at
    ) values (
        v_booking_1, v_event_id, v_venue_id, v_start, v_end, 50, 'Classroom',
        'Held', 2, v_expires
    );

    -- 2. Verify second tentative hold on same slot is blocked by constraint
    begin
        insert into public.venue_bookings (
            id, event_id, venue_id, start_at, end_at, expected_attendance, layout,
            status, requested_by, expires_at
        ) values (
            v_booking_2, v_event_id, v_venue_id, v_start, v_end, 50, 'Classroom',
            'Held', 2, v_expires
        );
        raise exception 'Second tentative hold should have been blocked';
    exception
        when exclusion_violation then
            -- Expected: exclusion constraint prevented second hold
            null;
    end;
end $$;

rollback;
