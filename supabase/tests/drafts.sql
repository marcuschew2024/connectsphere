-- SCRUM-15 database checks. Use an isolated test database after seed_users.sql
-- and create_events.sql. Everything below is rolled back; do not use production.
begin;

-- Simulate a history write failing, to prove the event update also rolls back.
create function public.test_draft_history_failure()
returns trigger language plpgsql as $$
begin
    if current_setting('connectsphere.fail_history', true) = 'on' then
        raise check_violation using message = 'Simulated history failure';
    end if;
    return new;
end;
$$;
create trigger test_draft_history_failure before insert on public.event_status_history
for each row execute function public.test_draft_history_failure();

do $$
declare
    original public.events;
    saved public.events;
    second_owner integer;
    complete_details jsonb := '{
        "title": "Campus workshop", "description": "Learn together",
        "purpose": "Share skills", "category": "Workshop",
        "event_datetime": "2099-10-20T06:00:00Z", "expected_attendance": 50
    }';
begin
    insert into public.app_users (display_name, role)
    values ('Test Organiser B', 'Organiser') returning id into second_owner;
    insert into public.events (organiser_id, title)
    values (1, 'First idea') returning * into original;

    select * into saved from public.save_event_draft(
        original.id, 1, '{"title":"Updated idea"}', false
    );
    assert saved.id = original.id, 'Saving must preserve the event ID';
    assert saved.status = 'Draft' and saved.submitted_at is null;
    assert saved.title = 'Updated idea' and saved.description is null;
    assert saved.created_at = original.created_at;
    assert not exists (select 1 from public.event_status_history where event_id = original.id),
        'Saving details must not create a status transition';

    assert not exists (
        select 1 from public.save_event_draft(original.id, second_owner, '{}', false)
    ), 'A different owner must not save this draft';

    begin
        perform public.save_event_draft(original.id, 1, '{"title":"Incomplete"}', true);
        raise exception 'Incomplete submission unexpectedly succeeded';
    exception when check_violation then
        null; -- The table constraint must reject an incomplete submitted request.
    end;
    select * into saved from public.events where id = original.id;
    assert saved.title = 'Updated idea' and saved.status = 'Draft';

    perform set_config('connectsphere.fail_history', 'on', true);
    begin
        perform public.save_event_draft(original.id, 1, complete_details, true);
        raise exception 'Submission with broken history unexpectedly succeeded';
    exception when check_violation then
        null;
    end;
    perform set_config('connectsphere.fail_history', 'off', true);
    select * into saved from public.events where id = original.id;
    assert saved.status = 'Draft' and saved.submitted_at is null,
        'History failure must roll back submission';
    assert saved.title = 'Updated idea', 'History failure must also roll back detail edits';

    select * into saved from public.save_event_draft(original.id, 1, complete_details, true);
    assert saved.id = original.id and saved.status = 'Submitted';
    assert saved.submitted_at is not null and saved.last_status_changed_by = 1;
    assert exists (
        select 1 from public.event_status_history where event_id = original.id
        and old_status = 'Draft' and new_status = 'Submitted' and changed_by = 1
    ), 'Submission must record the acting Organiser';

    assert not exists (
        select 1 from public.save_event_draft(original.id, 1, complete_details, true)
    ), 'A repeat submission must not change the event';
    assert not exists (
        select 1 from public.save_event_draft(original.id, 1, '{"title":"Too late"}', false)
    ), 'A submitted event must not be editable as a draft';
    assert (select count(*) from public.event_status_history where event_id = original.id) = 1,
        'Repeat submissions must not duplicate history';

    assert has_table_privilege('service_role', 'public.events', 'UPDATE');
    assert has_table_privilege('service_role', 'public.event_participants', 'UPDATE');
    assert has_function_privilege('service_role',
        'public.save_event_draft(uuid,integer,jsonb,boolean)', 'EXECUTE');
    assert not has_function_privilege('anon',
        'public.save_event_draft(uuid,integer,jsonb,boolean)', 'EXECUTE');
    assert not has_function_privilege('authenticated',
        'public.save_event_draft(uuid,integer,jsonb,boolean)', 'EXECUTE');
end;
$$;

rollback;
