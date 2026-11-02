-- SCRUM-79: the database frees a slot whose tentative hold has expired.
--
-- The engine already ignored an expired hold, but the exclusion constraint did not, so
-- search showed the slot free and the insert was then refused. These checks pin the
-- database half of that fix: the slot becomes requestable, the record survives, a live
-- hold still blocks, and a confirmation never keeps a hold deadline.

begin;

do $$
declare
    v_venue_id uuid := '79100000-0000-4000-8000-000000000001';
    v_event_id uuid := '79100000-0000-4000-8000-000000000002';
    v_hold uuid := gen_random_uuid();
    v_second uuid := gen_random_uuid();
    v_third uuid := gen_random_uuid();
    v_start timestamptz := now() + interval '9 days';
    v_end timestamptz := now() + interval '9 days 2 hours';
    v_status text;
    v_expires timestamptz;
begin
    insert into public.venues (
        id, name, location, capacity, facilities, accessibility, supported_layouts,
        operating_hours, created_by, setup_time_minutes, turnaround_time_minutes
    ) values (
        v_venue_id, 'SCRUM-79 Hold Release Venue', 'Building D Room 201', 80,
        '{}', '{}', '{Classroom}',
        '{"monday":{"opens":"08:00","closes":"22:00"},"tuesday":null,"wednesday":null,"thursday":null,"friday":null,"saturday":null,"sunday":null}',
        3, 0, 0
    );

    insert into public.events (
        id, title, description, purpose, category, event_datetime, expected_attendance,
        status, organiser_id, coordinator_id, submitted_at
    ) values (
        v_event_id, 'SCRUM-79 Hold Release Event', 'Test Description', 'Test Purpose',
        'Workshop', v_start, 40, 'Planning', 1, 2, now()
    );

    -- 1. A hold whose deadline has already passed.
    insert into public.venue_bookings (
        id, event_id, venue_id, start_at, end_at, expected_attendance, layout,
        status, requested_by, expires_at
    ) values (
        v_hold, v_event_id, v_venue_id, v_start, v_end, 50, 'Classroom',
        'Held', 2, now() - interval '1 hour'
    );

    -- 2. Another event may now take that slot: the stale hold is released first, so the
    --    tentative-hold exclusion constraint no longer refuses the request.
    insert into public.venue_bookings (
        id, event_id, venue_id, start_at, end_at, expected_attendance, layout,
        status, requested_by
    ) values (
        v_second, v_event_id, v_venue_id, v_start, v_end, 50, 'Classroom',
        'Requested', 2
    );

    -- 3. The expired hold is kept as history, moved out of the tentative tier.
    select status into v_status from public.venue_bookings where id = v_hold;
    if v_status is null then
        raise exception 'SCRUM-79: the expired hold row must be kept, not deleted';
    end if;
    if v_status <> 'Expired' then
        raise exception 'SCRUM-79: expected the lapsed hold to be Expired, got %', v_status;
    end if;

    -- 4. A live hold still holds the venue: a second tentative booking is refused.
    delete from public.venue_bookings where id = v_second;
    insert into public.venue_bookings (
        id, event_id, venue_id, start_at, end_at, expected_attendance, layout,
        status, requested_by, expires_at
    ) values (
        v_second, v_event_id, v_venue_id, v_start, v_end, 50, 'Classroom',
        'Held', 2, now() + interval '2 days'
    );
    begin
        insert into public.venue_bookings (
            id, event_id, venue_id, start_at, end_at, expected_attendance, layout,
            status, requested_by
        ) values (
            v_third, v_event_id, v_venue_id, v_start, v_end, 50, 'Classroom',
            'Requested', 2
        );
        raise exception 'SCRUM-79: a live hold must still block a second tentative booking';
    exception
        when exclusion_violation then
            null;  -- expected
    end;

    -- 5. Approving a held booking never keeps its deadline: a confirmed slot that still
    --    carried one was what let the engine treat a booked venue as free.
    update public.venue_bookings set status = 'Confirmed' where id = v_second;
    select expires_at into v_expires from public.venue_bookings where id = v_second;
    if v_expires is not null then
        raise exception 'SCRUM-79: a Confirmed booking must not keep a hold deadline';
    end if;
end $$;

rollback;
