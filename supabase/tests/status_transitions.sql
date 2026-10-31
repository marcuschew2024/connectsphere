-- Transaction rollback and privilege checks for SCRUM-135. All fixtures roll back.
begin;
alter table public.notifications add constraint scrum135_test_failure
    check (notification_type <> 'event_approved') not valid;
do $$
declare
    target_id uuid;
    terminal text;
begin
    assert not has_function_privilege('anon',
        'public.transition_event_intake(uuid,text,text,integer,text)', 'execute');
    assert not has_function_privilege('authenticated',
        'public.transition_event_intake(uuid,text,text,integer,text)', 'execute');
    assert has_function_privilege('service_role',
        'public.transition_event_intake(uuid,text,text,integer,text)', 'execute');
    assert not (select prosecdef from pg_proc
        where oid = 'public.transition_event_intake(uuid,text,text,integer,text)'::regprocedure);
    insert into public.events(title, description, purpose, category, event_datetime,
                              expected_attendance, submitted_at, status, organiser_id, coordinator_id)
    values ('SCRUM-135 rollback', 'Public', 'Private', 'Workshop', now() + interval '1 year',
            10, now(), 'Submitted', 1, 2) returning id into target_id;
    begin
        perform public.transition_event_intake(target_id, 'Submitted', 'Planning', 2);
        raise exception 'Expected notification failure';
    exception when check_violation then null;
    end;
    assert (select status = 'Submitted' and decision_by is null from public.events where id = target_id);
    assert not exists (select 1 from public.event_status_history h where h.event_id = target_id);
    assert not exists (select 1 from public.notifications n where n.event_id = target_id);
    foreach terminal in array array['Rejected', 'Cancelled', 'Completed'] loop
        insert into public.events(title, description, purpose, category, event_datetime,
                                  expected_attendance, submitted_at, status, organiser_id, coordinator_id)
        values ('SCRUM-135 terminal', 'Public', 'Private', 'Workshop', now() + interval '1 year',
                10, now(), terminal, 1, 2) returning id into target_id;
        begin
            update public.events set status = 'Planning' where id = target_id;
            raise exception 'Terminal event revived';
        exception when sqlstate 'PT409' then null;
        end;
        assert (select status = terminal from public.events where id = target_id);
    end loop;
end;
$$;
rollback;
