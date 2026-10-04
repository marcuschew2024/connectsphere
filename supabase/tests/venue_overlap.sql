-- SCRUM-33 database constraints: half-open boundaries, hard conflicts, and one hold.
begin;

do $$
declare
    venue_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    event_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    confirmed_id uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    hold_id uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    touching_id uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
begin
    insert into public.venues (
        id, name, location, capacity, facilities, accessibility, supported_layouts,
        operating_hours, created_by
    ) values (
        venue_id, 'SCRUM-33 overlap venue', 'SCRUM-33 test location', 100,
        '{}', '{}', '{Theatre}',
        '{"monday":{"opens":"09:00","closes":"18:00"},"tuesday":null,"wednesday":null,"thursday":null,"friday":null,"saturday":null,"sunday":null}',
        3
    );
    insert into public.events (
        id, title, description, purpose, category, event_datetime, expected_attendance,
        status, organiser_id, coordinator_id, submitted_at
    ) values (
        event_id, 'SCRUM-33 test event', 'Test event', 'Test overlap policy', 'Workshop',
        '2099-10-20T06:00:00Z', 20, 'Planning', 1, 2, now()
    );
    insert into public.venue_bookings (
        id, event_id, venue_id, start_at, end_at, expected_attendance, layout,
        status, requested_by
    ) values (
        confirmed_id, event_id, venue_id, '2099-10-20T06:00:00Z', '2099-10-20T08:00:00Z',
        20, 'Theatre', 'Confirmed', 2
    );

    begin
        insert into public.venue_bookings (
            event_id, venue_id, start_at, end_at, expected_attendance, layout,
            status, requested_by
        ) values (
            event_id, venue_id, '2099-10-20T07:00:00Z', '2099-10-20T09:00:00Z',
            20, 'Theatre', 'Confirmed', 2
        );
        raise exception 'overlapping confirmed booking was accepted';
    exception when exclusion_violation then null;
    end;

    insert into public.venue_bookings (
        id, event_id, venue_id, start_at, end_at, expected_attendance, layout,
        status, requested_by
    ) values (
        hold_id, event_id, venue_id, '2099-10-20T08:00:00Z', '2099-10-20T09:00:00Z',
        20, 'Theatre', 'Requested', 2
    );

    begin
        insert into public.venue_bookings (
            event_id, venue_id, start_at, end_at, expected_attendance, layout,
            status, requested_by
        ) values (
            event_id, venue_id, '2099-10-20T08:30:00Z', '2099-10-20T09:30:00Z',
            20, 'Theatre', 'Requested', 2
        );
        raise exception 'second tentative hold was accepted';
    exception when exclusion_violation then null;
    end;

    insert into public.venue_bookings (
        id, event_id, venue_id, start_at, end_at, expected_attendance, layout,
        status, requested_by
    ) values (
        touching_id, event_id, venue_id, '2099-10-20T09:00:00Z', '2099-10-20T10:00:00Z',
        20, 'Theatre', 'Confirmed', 2
    );
end;
$$;

rollback;