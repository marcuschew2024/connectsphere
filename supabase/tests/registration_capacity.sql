-- SCRUM-41 database contract and backend-only permissions. All fixtures roll back.
begin;
insert into public.app_users (id, display_name, role, is_demo)
select 41000 + n, 'Capacity test attendee ' || n, 'Attendee', true
from generate_series(1, 101) n;

do $$
declare target_event_id uuid; reg_id uuid; total integer; response jsonb;
begin
    insert into public.events (organiser_id, status) values (1, 'Draft') returning id into target_event_id;
    response := public.set_registration_capacity(target_event_id, 1, 100);
    if (response->>'registration_capacity')::integer <> 100 then
        raise exception 'capacity did not save';
    end if;
    -- Existing draft-save function must preserve the separate capacity setting.
    perform public.save_event_draft(target_event_id, 1, '{"title":"Capacity draft"}'::jsonb, false);
    if (select registration_capacity from public.events where id = target_event_id) <> 100 then
        raise exception 'saving draft cleared capacity';
    end if;
    update public.events set title = 'Capacity test', description = 'Test', purpose = 'Test',
        category = 'Workshop', event_datetime = '2099-01-01', expected_attendance = 120,
        submitted_at = now(), status = 'Confirmed' where id = target_event_id;
    -- Expected attendance is deliberately different; it is not the signup limit.
    for n in 1..100 loop
        perform public.register_event_attendee(target_event_id, 41000 + n);
    end loop;
    begin
        perform public.register_event_attendee(target_event_id, 41101);
        raise exception '101st registration was accepted';
    exception when sqlstate 'PT409' then
        if sqlerrm <> 'event_full' then raise; end if;
    end;
    select registered_count into total from public.events where id = target_event_id;
    if total <> 100 or (select count(*) from public.event_registrations where event_id = target_event_id) <> 100 then
        raise exception 'failed signup changed count';
    end if;
    begin
        update public.events set registration_capacity = 99 where id = target_event_id;
        raise exception 'capacity reduced below registrations';
    exception when check_violation then null;
    end;
    begin
        perform public.set_registration_capacity(target_event_id, 1, 120);
        raise exception 'confirmed capacity was editable';
    exception when sqlstate 'PT409' then
        if sqlerrm <> 'capacity_locked' then raise; end if;
    end;
    begin
        perform public.register_event_attendee(target_event_id, 41001);
        raise exception 'duplicate registration was accepted';
    exception when sqlstate 'PT409' then
        if sqlerrm <> 'already_registered' then raise; end if;
    end;
    -- Withdrawal support is a database seam for SCRUM-43, not a public API here.
    select id into reg_id from public.event_registrations r
    where r.event_id = target_event_id and attendee_id = 41001;
    update public.event_registrations set status = 'Withdrawn' where id = reg_id;
    perform public.register_event_attendee(target_event_id, 41101);
    if (select registered_count from public.events where id = target_event_id) <> 100 then
        raise exception 'withdrawal did not release exactly one place';
    end if;
end;
$$;

do $$
begin
    if has_table_privilege('anon', 'public.event_registrations', 'SELECT')
        or has_table_privilege('authenticated', 'public.event_registrations', 'INSERT')
        or has_function_privilege('anon', 'public.register_event_attendee(uuid,integer)', 'EXECUTE')
        or has_function_privilege('authenticated', 'public.set_registration_capacity(uuid,integer,integer)', 'EXECUTE') then
        raise exception 'browser role can bypass the Flask session';
    end if;
    if not (select relrowsecurity from pg_class where oid = 'public.event_registrations'::regclass) then
        raise exception 'RLS is disabled';
    end if;
end;
$$;
rollback;

-- Local acceptance fixtures only. This is never applied to a hosted environment.
insert into public.app_users (id, display_name, role, is_demo) values
    (41001, 'Capacity acceptance attendee A', 'Attendee', true),
    (41002, 'Capacity acceptance attendee B', 'Attendee', true);
grant delete on public.event_edit_log to service_role;
grant delete on public.access_denied_log to service_role;
