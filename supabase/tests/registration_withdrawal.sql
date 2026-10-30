-- Disposable database only. No fixtures survive this transaction.
begin;
do $$
declare target uuid; receipt jsonb; repeated jsonb;
begin
    insert into public.events (organiser_id, coordinator_id, title, description, purpose,
        category, expected_attendance, event_datetime, status, submitted_at, registration_capacity)
    values (1, 2, 'Withdrawal contract', 'Test', 'Test', 'Workshop', 2,
        '2099-01-01', 'Confirmed', now(), 1) returning id into target;
    perform public.set_event_withdrawal_policy(target, 1, '2098-12-31');
    perform public.register_event_attendee(target, 41001);
    receipt := public.withdraw_event_attendee(target, 41001);
    repeated := public.withdraw_event_attendee(target, 41001);
    if receipt is distinct from repeated or receipt->>'withdrawn_at' is null
        or receipt->>'status' <> 'Withdrawn' then
        raise exception 'withdrawal is not timestamped and idempotent';
    end if;
    if (select registered_count from public.events where id = target) <> 0
        or (select count(*) from public.notifications where event_id = target
            and notification_type = 'registration_withdrawn') <> 1 then
        raise exception 'withdrawal did not release exactly one place and one notification';
    end if;
    perform public.register_event_attendee(target, 41002);
    begin
        perform public.set_event_withdrawal_policy(target, 1, null);
        raise exception 'organiser changed conditions after signup';
    exception when sqlstate 'PT409' then
        if sqlerrm <> 'withdrawal_policy_locked' then raise; end if;
    end;
    update public.events set withdrawal_closes_at = '2000-01-01' where id = target;
    begin
        update public.event_registrations set status = 'Withdrawn'
        where event_id = target and attendee_id = 41002;
        raise exception 'direct backend write bypassed conditions';
    exception when sqlstate 'PT409' then
        if sqlerrm <> 'withdrawal_deadline_passed' then raise; end if;
    end;
    if (select registered_count from public.events where id = target) <> 1 then
        raise exception 'refused withdrawal changed capacity';
    end if;
    update public.events set withdrawal_closes_at = null where id = target;
    -- A broken notification must roll back the registration and capacity together.
    alter table public.notifications add constraint test_withdrawal_notification_failure
        check (notification_type <> 'registration_withdrawn') not valid;
    begin
        perform public.withdraw_event_attendee(target, 41002);
        raise exception 'notification failure was swallowed';
    exception when check_violation then null;
    end;
    alter table public.notifications drop constraint test_withdrawal_notification_failure;
    if (select registered_count from public.events where id = target) <> 1
        or (select status from public.event_registrations where event_id = target
            and attendee_id = 41002) <> 'Registered' then
        raise exception 'notification failure left partial state';
    end if;
end;
$$;
do $$
begin
    if has_function_privilege('anon', 'public.withdraw_event_attendee(uuid,integer)', 'EXECUTE')
        or has_function_privilege('authenticated', 'public.withdraw_event_attendee(uuid,integer)', 'EXECUTE')
        or has_function_privilege('anon', 'public.set_event_withdrawal_policy(uuid,integer,timestamptz)', 'EXECUTE')
        or has_function_privilege('authenticated', 'public.get_event_withdrawal_policy(uuid,integer)', 'EXECUTE') then
        raise exception 'browser role can impersonate a withdrawal actor';
    end if;
    if exists (select 1 from pg_proc where proname in ('withdraw_event_attendee',
        'get_event_withdrawal_policy', 'set_event_withdrawal_policy',
        'guard_registration_withdrawal', 'record_registration_withdrawal') and prosecdef) then
        raise exception 'withdrawal function bypasses RLS';
    end if;
end;
$$;
rollback;
