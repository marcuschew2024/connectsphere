-- Prove audit failures roll back the venue change, and browser roles cannot write.
begin;
create function public.reject_test_venue_audit() returns trigger
language plpgsql as $$ begin raise exception 'simulated audit failure'; end; $$;
create trigger reject_test_venue_audit before insert on public.venue_update_history
    for each row execute function public.reject_test_venue_audit();
do $$
declare
    venue public.venues;
    details jsonb;
begin
    if has_function_privilege('anon', 'public.update_venue_details(uuid,jsonb,integer,integer)', 'execute')
        or has_function_privilege('authenticated', 'public.update_venue_details(uuid,jsonb,integer,integer)', 'execute')
        or not has_function_privilege('service_role', 'public.update_venue_details(uuid,jsonb,integer,integer)', 'execute')
        or has_table_privilege('service_role', 'public.venue_update_history', 'insert')
        or has_table_privilege('service_role', 'public.venues', 'update') then
        raise exception 'Unexpected venue editing permissions';
    end if;
    insert into public.venues (name, location, capacity, facilities, accessibility,
                              supported_layouts, operating_hours, created_by)
    values ('Audit rollback test', 'Test only', 100, '{}', '{}', '{Classroom}',
        '{"monday":{"opens":"09:00","closes":"18:00"},"tuesday":null,"wednesday":null,"thursday":null,"friday":null,"saturday":null,"sunday":null}', 3)
    returning * into venue;
    details := jsonb_build_object('capacity', 20, 'facilities', '[]'::jsonb,
        'accessibility', '[]'::jsonb, 'supported_layouts', '["Classroom"]'::jsonb,
        'operating_hours', venue.operating_hours);
    begin
        perform public.update_venue_details(venue.id, details, 3, 1);
        raise exception 'Expected simulated audit failure';
    exception when raise_exception then
        if sqlerrm <> 'simulated audit failure' then raise; end if;
    end;
    if (select to_jsonb(v) from public.venues v where id = venue.id) <> to_jsonb(venue)
        or exists (select 1 from public.venue_update_history where venue_id = venue.id) then
        raise exception 'Failed audit did not roll back the venue update';
    end if;
end;
$$;
rollback;
