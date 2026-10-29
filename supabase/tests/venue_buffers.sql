-- SCRUM-129 database tests for venue setup and turnaround time buffers.
begin;

do $$
declare
    venue_id uuid := '12900000-0000-4000-8000-000000000001';
    v record;
    details jsonb;
begin
    -- 1. Insert venue with setup and turnaround times
    insert into public.venues (
        id, name, location, capacity, facilities, accessibility, supported_layouts,
        operating_hours, setup_time_minutes, turnaround_time_minutes, created_by
    ) values (
        venue_id, 'Buffer Test Hall', 'Building B Floor 2', 50,
        '{}', '{}', '{Theatre}',
        '{"monday":{"opens":"08:00","closes":"20:00"},"tuesday":null,"wednesday":null,"thursday":null,"friday":null,"saturday":null,"sunday":null}',
        30, 45, 3
    );

    select * into v from public.venues where id = venue_id;
    if v.setup_time_minutes <> 30 or v.turnaround_time_minutes <> 45 then
        raise exception 'Venue setup/turnaround times were not stored correctly';
    end if;

    -- 2. Test constraint: negative minutes should fail
    begin
        insert into public.venues (
            name, location, capacity, facilities, accessibility, supported_layouts,
            operating_hours, setup_time_minutes, turnaround_time_minutes, created_by
        ) values (
            'Negative Setup Venue', 'Location', 50, '{}', '{}', '{Theatre}',
            '{"monday":{"opens":"08:00","closes":"20:00"}}', -10, 0, 3
        );
        raise exception 'Negative setup_time_minutes was accepted';
    exception when check_violation then null;
    end;

    begin
        insert into public.venues (
            name, location, capacity, facilities, accessibility, supported_layouts,
            operating_hours, setup_time_minutes, turnaround_time_minutes, created_by
        ) values (
            'Negative Turnaround Venue', 'Location', 50, '{}', '{}', '{Theatre}',
            '{"monday":{"opens":"08:00","closes":"20:00"}}', 0, -5, 3
        );
        raise exception 'Negative turnaround_time_minutes was accepted';
    exception when check_violation then null;
    end;

    -- 3. Update venue details via update_venue_details RPC including buffers
    details := jsonb_build_object(
        'capacity', 60,
        'facilities', '[]'::jsonb,
        'accessibility', '[]'::jsonb,
        'supported_layouts', '["Theatre"]'::jsonb,
        'operating_hours', v.operating_hours,
        'setup_time_minutes', 15,
        'turnaround_time_minutes', 20
    );

    perform public.update_venue_details(venue_id, details, 3, v.revision);

    select * into v from public.venues where id = venue_id;
    if v.setup_time_minutes <> 15 or v.turnaround_time_minutes <> 20 or v.capacity <> 60 then
        raise exception 'update_venue_details did not update setup/turnaround minutes properly';
    end if;
end;
$$;

rollback;
