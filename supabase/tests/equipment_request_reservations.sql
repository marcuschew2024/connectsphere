-- Disposable database only: backend permissions and all-or-nothing audit failure.
begin;
do $$
declare role_name text;
begin
    foreach role_name in array array['anon', 'authenticated'] loop
        if has_function_privilege(role_name, 'public.save_equipment_request_reservations(uuid,timestamptz,timestamptz,jsonb,text,integer,integer)', 'execute')
            or has_table_privilege(role_name, 'public.equipment_reservations', 'select,insert,update,delete') then
            raise exception 'Browser role can bypass the reservations API';
        end if;
    end loop;
    if not has_function_privilege('service_role', 'public.save_equipment_request_reservations(uuid,timestamptz,timestamptz,jsonb,text,integer,integer)', 'execute') then
        raise exception 'Backend cannot save reservations';
    end if;
end;
$$;
insert into public.events (id, title, description, purpose, category, event_datetime,
    expected_attendance, organiser_id, coordinator_id, status, submitted_at)
values ('aa000000-0000-4000-8000-000000000038', 'Reservation audit test', 'Test', 'Test', 'Workshop',
    '2099-10-20T06:00:00Z', 20, 1, 2, 'Planning', now());
insert into public.equipment_items (id, equipment_type, description, total_quantity,
    location, operational_status, created_by, updated_by)
values ('cc000000-0000-4000-8000-000000000038', 'Audit microphone', 'Test', 1, 'AV', 'Operational', 4, 4);
insert into public.equipment_requests (id, event_id, requested_by)
values ('bb000000-0000-4000-8000-000000000038', 'aa000000-0000-4000-8000-000000000038', 2);
insert into public.equipment_request_items (request_id, position, equipment_id, quantity, technical_notes, equipment_type, location)
values ('bb000000-0000-4000-8000-000000000038', 1, 'cc000000-0000-4000-8000-000000000038', 1, '', 'Audit microphone', 'AV');
create function public.reject_test_reservation_audit() returns trigger
language plpgsql as $$ begin raise exception 'simulated audit failure'; end; $$;
create trigger reject_test_reservation_audit before insert on public.equipment_request_history
    for each row execute function public.reject_test_reservation_audit();
do $$
begin
    begin
        perform public.save_equipment_request_reservations(
            'bb000000-0000-4000-8000-000000000038', '2099-10-20T06:00:00Z', '2099-10-20T07:00:00Z',
            '[{"equipment_id":"cc000000-0000-4000-8000-000000000038","quantity":1}]', '', 1, 4
        );
        raise exception 'Expected audit failure';
    exception when raise_exception then
        if sqlerrm <> 'simulated audit failure' then raise; end if;
    end;
    if exists (select 1 from public.equipment_reservations where equipment_id = 'cc000000-0000-4000-8000-000000000038')
        or exists (select 1 from public.equipment_requests where id = 'bb000000-0000-4000-8000-000000000038'
            and (status <> 'Requested' or revision <> 1 or reservation_start_at is not null))
        or exists (select 1 from public.equipment_request_history where request_id = 'bb000000-0000-4000-8000-000000000038') then
        raise exception 'Failed audit left a partial reservation';
    end if;
end;
$$;
rollback;
