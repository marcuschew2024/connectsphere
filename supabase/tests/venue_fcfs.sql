-- SCRUM-120 database constraint tests: tentative hold + FCFS (confirmed beats hold).
-- Verifies three DB-level rules:
--   1. A Confirmed booking coexists with a Held booking on the same slot (FCFS allowed).
--   2. A second Held/Requested booking on the same slot is blocked by the exclusion constraint.
--   3. A Blocked row prevents a Confirmed booking on the same slot.
begin;

do $$
declare
    v_venue_id   uuid := '12000000-0000-4000-8000-000000000001';
    v_event_id   uuid := '12000000-0000-4000-8000-000000000002';
    v_event_id2  uuid := '12000000-0000-4000-8000-000000000003';
    v_confirmed  uuid := gen_random_uuid();
    v_held       uuid := gen_random_uuid();
    v_held2      uuid := gen_random_uuid();
    v_blocked    uuid := gen_random_uuid();
    v_start      timestamptz := '2099-11-10T08:00:00Z';
    v_end        timestamptz := '2099-11-10T10:00:00Z';
    v_expires    timestamptz := '2099-11-08T08:00:00Z';
begin
    -- Seed test venue
    insert into public.venues (
        id, name, location, capacity, facilities, accessibility, supported_layouts,
        operating_hours, created_by
    ) values (
        v_venue_id, 'SCRUM-120 FCFS Test Venue', 'Block A Room 10', 100,
        '{}', '{}', '{Theatre}',
        '{"monday":{"opens":"08:00","closes":"20:00"},"tuesday":null,"wednesday":null,"thursday":null,"friday":null,"saturday":null,"sunday":null}',
        3
    );

    -- Seed two test events
    insert into public.events (
        id, title, description, purpose, category, event_datetime, expected_attendance,
        status, organiser_id, coordinator_id, submitted_at
    ) values (
        v_event_id, 'SCRUM-120 Test Event A', 'FCFS test', 'Testing FCFS', 'Workshop',
        v_start, 50, 'Planning', 1, 2, now()
    );
    insert into public.events (
        id, title, description, purpose, category, event_datetime, expected_attendance,
        status, organiser_id, coordinator_id, submitted_at
    ) values (
        v_event_id2, 'SCRUM-120 Test Event B', 'FCFS test B', 'Testing FCFS', 'Workshop',
        v_start, 50, 'Planning', 1, 2, now()
    );

    -- -----------------------------------------------------------------------
    -- Test 1: A Confirmed booking and a Held booking CAN coexist on the same
    -- slot. The DB constraint only blocks two hard (Confirmed/Blocked) rows or
    -- two soft (Requested/Pending/Held) rows; one of each tier is allowed so
    -- that the application layer can implement the FCFS "confirmed beats hold"
    -- rule and update/cancel the hold separately.
    -- -----------------------------------------------------------------------
    insert into public.venue_bookings (
        id, event_id, venue_id, start_at, end_at, expected_attendance, layout,
        status, requested_by, expires_at
    ) values (
        v_held, v_event_id, v_venue_id, v_start, v_end, 50, 'Theatre',
        'Held', 2, v_expires
    );

    insert into public.venue_bookings (
        id, event_id, venue_id, start_at, end_at, expected_attendance, layout,
        status, requested_by
    ) values (
        v_confirmed, v_event_id2, v_venue_id, v_start, v_end, 50, 'Theatre',
        'Confirmed', 2
    );
    -- If we reach here without exception, the coexistence test passes.

    -- -----------------------------------------------------------------------
    -- Test 2: A second Held (or Requested) booking on the same venue/slot IS
    -- blocked by the venue_bookings_one_tentative_hold exclusion constraint.
    -- -----------------------------------------------------------------------
    begin
        insert into public.venue_bookings (
            id, event_id, venue_id, start_at, end_at, expected_attendance, layout,
            status, requested_by, expires_at
        ) values (
            v_held2, v_event_id, v_venue_id, v_start, v_end, 50, 'Theatre',
            'Held', 2, v_expires
        );
        raise exception 'Second tentative hold should have been blocked by exclusion constraint';
    exception
        when exclusion_violation then
            -- Expected: venue_bookings_one_tentative_hold fired.
            null;
    end;

    -- -----------------------------------------------------------------------
    -- Test 3: A Blocked (maintenance) row on the same slot prevents a
    -- Confirmed booking, proving that blocked/maintenance periods count as
    -- unavailable (SCRUM-120 AC3 / SCRUM-33 AC3).
    -- We reuse the same slot on a fresh venue to avoid interference.
    -- -----------------------------------------------------------------------
    declare
        v_venue2 uuid := '12000000-0000-4000-8000-000000000004';
        v_event3 uuid := '12000000-0000-4000-8000-000000000005';
        v_event4 uuid := '12000000-0000-4000-8000-000000000006';
    begin
        insert into public.venues (
            id, name, location, capacity, facilities, accessibility,
            supported_layouts, operating_hours, created_by
        ) values (
            v_venue2, 'SCRUM-120 Blocked Test Venue', 'Block B Room 5', 50,
            '{}', '{}', '{Classroom}',
            '{"monday":{"opens":"08:00","closes":"20:00"},"tuesday":null,"wednesday":null,"thursday":null,"friday":null,"saturday":null,"sunday":null}',
            3
        );
        insert into public.events (
            id, title, description, purpose, category, event_datetime,
            expected_attendance, status, organiser_id, coordinator_id, submitted_at
        ) values (
            v_event3, 'SCRUM-120 Blocked Event A', 'blocked test', 'blocked', 'Workshop',
            v_start, 30, 'Planning', 1, 2, now()
        );
        insert into public.events (
            id, title, description, purpose, category, event_datetime,
            expected_attendance, status, organiser_id, coordinator_id, submitted_at
        ) values (
            v_event4, 'SCRUM-120 Blocked Event B', 'blocked test', 'blocked', 'Workshop',
            v_start, 30, 'Planning', 1, 2, now()
        );

        -- Insert a Blocked row (maintenance period)
        insert into public.venue_bookings (
            id, event_id, venue_id, start_at, end_at, expected_attendance, layout,
            status, requested_by
        ) values (
            v_blocked, v_event3, v_venue2, v_start, v_end, 30, 'Classroom',
            'Blocked', 2
        );

        -- Attempt to insert a Confirmed booking on the same slot — must be blocked
        begin
            insert into public.venue_bookings (
                event_id, venue_id, start_at, end_at, expected_attendance, layout,
                status, requested_by
            ) values (
                v_event4, v_venue2, v_start, v_end, 30, 'Classroom',
                'Confirmed', 2
            );
            raise exception 'Confirmed booking should have been blocked by the maintenance period';
        exception
            when exclusion_violation then
                -- Expected: venue_bookings_no_overlap_hard fired.
                null;
        end;
    end;
end $$;

rollback;
