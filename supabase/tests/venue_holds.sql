-- SCRUM-79 tests: tentative venue holds and expiry constraints.
begin;

do $$
declare
    v_venue_id uuid;
    v_event_id uuid;
    v_user_id integer;
    v_booking_1 uuid := gen_random_uuid();
    v_booking_2 uuid := gen_random_uuid();
    v_start timestamptz := now() + interval '5 days';
    v_end timestamptz := now() + interval '5 days 2 hours';
    v_expires timestamptz := now() + interval '2 days';
begin
    select id into v_venue_id from public.venues limit 1;
    select id into v_event_id from public.events limit 1;
    select id into v_user_id from public.app_users limit 1;

    -- 1. Insert a booking with status 'Held' and expires_at
    insert into public.venue_bookings (
        id, event_id, venue_id, start_at, end_at, expected_attendance, layout,
        status, requested_by, expires_at
    ) values (
        v_booking_1, v_event_id, v_venue_id, v_start, v_end, 50, 'Classroom',
        'Held', v_user_id, v_expires
    );

    -- 2. Verify second tentative hold on same slot is blocked by constraint
    begin
        insert into public.venue_bookings (
            id, event_id, venue_id, start_at, end_at, expected_attendance, layout,
            status, requested_by, expires_at
        ) values (
            v_booking_2, v_event_id, v_venue_id, v_start, v_end, 50, 'Classroom',
            'Held', v_user_id, v_expires
        );
        raise exception 'Second tentative hold should have been blocked';
    exception
        when exclusion_violation then
            -- Expected: exclusion constraint prevented second hold
            null;
    end;

    -- 3. Clean up test records
    delete from public.venue_bookings where id in (v_booking_1, v_booking_2);
end $$;

rollback;
