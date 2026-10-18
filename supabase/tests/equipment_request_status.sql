-- SCRUM-38: restrict direct writes and roll back status if audit persistence fails.
begin;
do $$
declare role_name text;
begin
    foreach role_name in array array['anon', 'authenticated'] loop
        if has_function_privilege(role_name, 'public.update_equipment_request_status(uuid,text,text,integer,integer)', 'execute')
            or has_table_privilege(role_name, 'public.equipment_request_history', 'select,insert,update,delete') then
            raise exception 'Browser role can bypass status API';
        end if;
    end loop;
    if not has_function_privilege('service_role', 'public.update_equipment_request_status(uuid,text,text,integer,integer)', 'execute')
        or has_table_privilege('service_role', 'public.equipment_requests', 'update')
        or has_table_privilege('service_role', 'public.equipment_request_history', 'insert,update,delete') then
        raise exception 'Unexpected status backend permissions';
    end if;
    if not (select relrowsecurity from pg_class where oid = 'public.equipment_request_history'::regclass) then
        raise exception 'History RLS must be enabled';
    end if;
end;
$$;

insert into public.events (id, title, description, purpose, category, event_datetime,
    expected_attendance, organiser_id, coordinator_id, status, submitted_at)
values ('aa000000-0000-4000-8000-000000000038', 'Status audit test', 'Test', 'Test', 'Workshop',
    '2099-10-20T06:00:00Z', 20, 1, 2, 'Planning', now());
insert into public.equipment_requests (id, event_id, requested_by)
values ('bb000000-0000-4000-8000-000000000038', 'aa000000-0000-4000-8000-000000000038', 2);
create function public.reject_test_request_audit() returns trigger
language plpgsql as $$ begin raise exception 'simulated audit failure'; end; $$;
create trigger reject_test_request_audit before insert on public.equipment_request_history
    for each row execute function public.reject_test_request_audit();
do $$
begin
    begin
        perform public.update_equipment_request_status(
            'bb000000-0000-4000-8000-000000000038', 'Reserved', 'Audit rollback test', 1, 4
        );
        raise exception 'Expected audit failure';
    exception when raise_exception then
        if sqlerrm <> 'simulated audit failure' then raise; end if;
    end;
    if exists (select 1 from public.equipment_requests
        where id = 'bb000000-0000-4000-8000-000000000038'
        and (status <> 'Requested' or revision <> 1 or updated_by is not null or updated_at is not null or update_notes <> ''))
        or exists (select 1 from public.equipment_request_history
            where request_id = 'bb000000-0000-4000-8000-000000000038') then
        raise exception 'Failed audit left a partial status update';
    end if;
end;
$$;
rollback;
