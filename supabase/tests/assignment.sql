-- Real PostgreSQL regression checks for SCRUM-16/17. All test rows roll back.
begin;
do $$
declare
    draft public.events;
    saved public.events;
    assigned_id integer;
    i integer;
    details jsonb := '{"title":"Workshop","description":"Learn together",
        "purpose":"Share skills","category":"Workshop",
        "event_datetime":"2099-10-20T06:00:00Z","expected_attendance":50}';
begin
    select id into assigned_id from public.app_users
    where role = 'Coordinator' order by id limit 1;

    for i in 1..10 loop
        insert into public.events (organiser_id, title)
        values (1, 'Draft ' || i) returning * into draft;
        assert draft.coordinator_id is null and draft.coordinator_assigned_at is null;
        select * into saved from public.save_event_draft(draft.id, 1, details, true);
        assert saved.status = 'Submitted' and saved.coordinator_id = assigned_id,
            'Each submitted draft must have exactly one Coordinator';
        assert saved.coordinator_assigned_at is not null and saved.submitted_at is not null;
        assert (select count(*) from public.event_participants
                where event_id = saved.id and role = 'Coordinator') = 1;
        assert (select count(*) from public.event_status_history
                where event_id = saved.id and new_status = 'Submitted'
                and changed_by = 1 and changed_at is not null) = 1;
        assert not exists (select 1 from public.save_event_draft(draft.id, 1, details, true)),
            'Repeated submission must not duplicate assignment or history';
    end loop;

    insert into public.events (organiser_id, title, description, purpose, category,
                              event_datetime, expected_attendance, status, submitted_at)
    values (1, 'Direct request', 'Learn', 'Share', 'Workshop',
            '2099-10-20', 50, 'Submitted', now()) returning * into saved;
    assert saved.coordinator_id = assigned_id and saved.coordinator_assigned_at is not null;

    -- With no Coordinator, fail the whole submission and keep the draft editable.
    update public.app_users set role = 'Attendee' where role = 'Coordinator';
    insert into public.events (organiser_id, title) values (1, 'No Coordinator')
    returning * into draft;
    begin
        perform public.save_event_draft(draft.id, 1, details, true);
        raise exception 'Expected no-Coordinator failure' using errcode = 'check_violation';
    exception when raise_exception then
        assert sqlerrm = 'No Coordinator is available to assign this request';
    end;
    select * into saved from public.events where id = draft.id;
    assert saved.status = 'Draft' and saved.submitted_at is null;
    assert not exists (select 1 from public.event_status_history where event_id = draft.id);
end;
$$;
rollback;
