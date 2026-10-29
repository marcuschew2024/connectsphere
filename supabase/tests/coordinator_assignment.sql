-- Real PostgreSQL checks for SCRUM-130. All test rows roll back.
begin;
do $$
declare
    lead_id integer;
    coordinator_a integer;
    coordinator_b integer;
    draft public.events;
    saved public.events;
    result jsonb;
    details jsonb := '{"title":"Workshop","description":"Learn together",
        "purpose":"Share skills","category":"Workshop",
        "event_datetime":"2099-10-20T06:00:00Z","expected_attendance":50}';
begin
    select id into lead_id from public.app_users
    where role = 'Event Coordinator Lead' order by id limit 1;
    select id into coordinator_a from public.app_users
    where role = 'Coordinator' order by id limit 1;
    select id into coordinator_b from public.app_users
    where role = 'Coordinator' and id <> coordinator_a order by id limit 1;
    assert lead_id is not null and coordinator_b is not null, 'Fixture users missing';

    -- AC1: a submitted request enters the unassigned queue (no auto-assignment).
    insert into public.events (organiser_id, title) values (1, 'Queue') returning * into draft;
    select * into saved from public.save_event_draft(draft.id, 1, details, true);
    assert saved.status = 'Submitted' and saved.coordinator_id is null
        and saved.coordinator_assigned_at is null, 'Submission must stay unassigned';
    assert not exists (select 1 from public.event_participants
                       where event_id = saved.id and role = 'Coordinator');

    -- AC3: assign. Event, membership, history and notification change together.
    result := public.assign_coordinator_by_lead(saved.id, coordinator_a, lead_id);
    assert result ->> 'outcome' = 'assigned' and result -> 'previous_coordinator_id' = 'null';
    select * into saved from public.events where id = saved.id;
    assert saved.coordinator_id = coordinator_a and saved.coordinator_assigned_at is not null
        and saved.status = 'Submitted', 'Assignment keeps the Submitted status';
    assert (select array_agg(user_id) from public.event_participants
            where event_id = saved.id and role = 'Coordinator') = array[coordinator_a];
    assert (select count(*) from public.event_status_history where event_id = saved.id
            and action = 'coordinator_assigned' and changed_by = lead_id) = 1;
    assert (select count(*) from public.notifications where event_id = saved.id
            and recipient_id = coordinator_a and notification_type = 'coordinator_assigned') = 1;
    assert (select count(*) from public.notifications where event_id = saved.id
            and recipient_id = 1 and notification_type = 'request_assigned') = 1,
        'The Organiser is told once the request leaves the Lead queue';

    -- AC3/AC4: reassign. The previous Coordinator loses membership and is told.
    result := public.assign_coordinator_by_lead(saved.id, coordinator_b, lead_id);
    assert result ->> 'outcome' = 'reassigned'
        and (result ->> 'previous_coordinator_id')::integer = coordinator_a;
    assert (select array_agg(user_id) from public.event_participants
            where event_id = saved.id and role = 'Coordinator') = array[coordinator_b];
    assert (select count(*) from public.notifications where event_id = saved.id
            and recipient_id = coordinator_b and notification_type = 'coordinator_assigned') = 1;
    assert (select count(*) from public.notifications where event_id = saved.id
            and recipient_id = coordinator_a and notification_type = 'coordinator_unassigned') = 1;
    assert (select count(*) from public.notifications where event_id = saved.id
            and recipient_id = 1) = 1, 'Reassignment is not relayed to the Organiser';

    -- Refusals leave everything unchanged.
    begin
        perform public.assign_coordinator_by_lead(saved.id, coordinator_b, lead_id);
        raise exception 'expected already_assigned';
    exception when sqlstate 'PT409' then assert sqlerrm = 'already_assigned'; end;
    begin
        perform public.assign_coordinator_by_lead(saved.id, coordinator_a, coordinator_a);
        raise exception 'expected Lead required';
    exception when sqlstate 'PT403' then null; end;
    begin
        perform public.assign_coordinator_by_lead(saved.id, 1, lead_id);
        raise exception 'expected not_a_coordinator';
    exception when sqlstate '22023' then assert sqlerrm = 'not_a_coordinator'; end;
    select * into saved from public.events where id = saved.id;
    assert saved.coordinator_id = coordinator_b;

    insert into public.events (organiser_id, title) values (1, 'Private') returning * into draft;
    begin
        perform public.assign_coordinator_by_lead(draft.id, coordinator_a, lead_id);
        raise exception 'expected draft hidden';
    exception when sqlstate 'PT404' then null; end;

    -- Terminal events cannot be re-routed.
    update public.events set status = 'Rejected' where id = saved.id;
    begin
        perform public.assign_coordinator_by_lead(saved.id, coordinator_a, lead_id);
        raise exception 'expected closed';
    exception when sqlstate 'PT409' then assert sqlerrm = 'closed'; end;

    -- The new invariant: a decided request must have a Coordinator, and an assignment
    -- written directly still records when it happened.
    begin
        insert into public.events (organiser_id, title, description, purpose, category,
                                   event_datetime, expected_attendance, status, submitted_at)
        values (1, 'Unrouted', 'Learn', 'Share', 'Workshop', '2099-10-20', 50,
                'Planning', now());
        raise exception 'expected check violation';
    exception when check_violation then null; end;
    update public.events set coordinator_id = coordinator_a where id = draft.id
    returning * into draft;
    assert draft.coordinator_assigned_at is not null, 'Direct writes are still timestamped';
end;
$$;
rollback;
