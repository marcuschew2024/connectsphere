-- SCRUM-163: persisted calendar windows match buffer enforcement, including touching.
-- Fixtures roll back; run only in the disposable acceptance stack.
begin;
do $$
declare
    room uuid := gen_random_uuid();
    first_event uuid := gen_random_uuid();
    second_event uuid := gen_random_uuid();
    first_booking uuid;
    row_data record;
begin
    insert into public.venues (
        id, name, location, capacity, facilities, accessibility, supported_layouts,
        operating_hours, setup_time_minutes, turnaround_time_minutes, created_by
    ) values (
        room, 'Calendar buffer regression', 'Disposable campus', 100, '{}', '{}', '{Classroom}',
        '{"monday":null,"tuesday":{"opens":"09:00","closes":"18:00"},"wednesday":null,"thursday":null,"friday":null,"saturday":null,"sunday":null}', 30, 30, 3
    );
    insert into public.events (
        id, title, description, purpose, category, event_datetime, event_end_datetime,
        expected_attendance, status, organiser_id, coordinator_id, submitted_at
    ) values
        (first_event, 'Calendar buffers A', 'Workshop', 'Learning', 'Workshop',
         '2099-10-20T06:00:00Z', '2099-10-20T07:00:00Z', 20, 'Planning', 1, 2, now()),
        (second_event, 'Calendar buffers B', 'Workshop', 'Learning', 'Workshop',
         '2099-10-20T08:00:00Z', '2099-10-20T09:00:00Z', 20, 'Planning', 1, 2, now());
    insert into public.venue_bookings (
        event_id, venue_id, start_at, end_at, expected_attendance, layout, requested_by, status
    ) values (
        first_event, room, '2099-10-20T06:00:00Z', '2099-10-20T07:00:00Z', 20, 'Classroom', 2, 'Confirmed'
    ) returning id into first_booking;
    select * into row_data from public.venue_bookings where id = first_booking;
    if row_data.occupied_start is distinct from '2099-10-20T05:30:00Z'::timestamptz
       or row_data.occupied_end is distinct from '2099-10-20T07:30:00Z'::timestamptz
       or row_data.start_at is distinct from '2099-10-20T06:00:00Z'::timestamptz
       or row_data.end_at is distinct from '2099-10-20T07:00:00Z'::timestamptz then
        raise exception 'Calendar occupancy must include buffers without changing event times';
    end if;
    begin
        insert into public.venue_bookings (
            event_id, venue_id, start_at, end_at, expected_attendance, layout, requested_by, status
        ) values (
            second_event, room, '2099-10-20T07:30:00Z', '2099-10-20T08:30:00Z', 20, 'Classroom', 2, 'Confirmed'
        );
        raise exception 'A setup-only overlap must fail at the database boundary';
    exception when exclusion_violation then
        null;
    end;
    -- 16:00 start minus 30-minute setup touches, but does not overlap, the first
    -- booking's 15:00 end plus 30-minute turnaround. This insert must succeed.
    insert into public.venue_bookings (
        event_id, venue_id, start_at, end_at, expected_attendance, layout, requested_by, status
    ) values (
        second_event, room, '2099-10-20T08:00:00Z', '2099-10-20T09:00:00Z', 20, 'Classroom', 2, 'Confirmed'
    );
end;
$$;
rollback;
