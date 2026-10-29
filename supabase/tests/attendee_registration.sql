-- Disposable database only. Verify backend-only privileges and all-or-nothing delivery.
begin;
do $$
declare
    target_id uuid;
    browser_role text;
begin
    foreach browser_role in array array['anon', 'authenticated'] loop
        if has_function_privilege(browser_role,
            'public.register_event_attendee_with_information(uuid,integer,text)', 'execute') then
            raise exception 'Browser roles must not execute the registration RPC';
        end if;
        if has_table_privilege(browser_role, 'public.event_registrations', 'select,insert,update') then
            raise exception 'Browser roles must not access registrations';
        end if;
    end loop;
    if not (select relrowsecurity from pg_class
            where oid = 'public.event_registrations'::regclass) then
        raise exception 'Registration RLS must remain enabled';
    end if;
    if exists (select 1 from pg_proc where oid in (
        'public.register_event_attendee_with_information(uuid,integer,text)'::regprocedure,
        'public.guard_registration_eligibility()'::regprocedure,
        'public.record_registration_receipt()'::regprocedure
    ) and prosecdef) then
        raise exception 'Registration functions must not bypass RLS';
    end if;

    insert into public.events (title, description, purpose, category, expected_attendance,
        event_datetime, organiser_id, status, registration_capacity, submitted_at)
    values ('Receipt rollback check', 'Test', 'Test', 'Workshop', 1,
        '2099-10-20T06:00:00Z', 1, 'Confirmed', 1, '2026-10-01T06:00:00Z')
    returning id into target_id;

    -- Force confirmation delivery to fail AFTER the capacity increment/registration.
    alter table public.notifications add constraint scrum40_test_delivery
        check (notification_type <> 'registration_confirmed');
    begin
        perform public.register_event_attendee_with_information(target_id, 5, '');
        raise exception 'A failed receipt must not return a successful registration';
    exception when check_violation then null;
    end;
    if (select registered_count from public.events where id = target_id) <> 0
        or exists (select 1 from public.event_registrations r where r.event_id = target_id)
        or exists (select 1 from public.event_participants p where p.event_id = target_id)
        or exists (select 1 from public.notifications n where n.event_id = target_id) then
        raise exception 'Failed confirmation left a partial registration';
    end if;
end;
$$;
rollback;
