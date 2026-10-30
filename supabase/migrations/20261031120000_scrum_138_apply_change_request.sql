-- SCRUM-138 (R06): approving a change request applies it atomically (Decision Log D36).
-- Run after 20261025000000_scrum_46_change_requests.sql, create_events.sql,
-- create_venue_bookings.sql and create_equipment_reservations.sql. Safe to rerun.
begin;

-- The Organiser's proposed values, and what approval actually changed.
alter table public.event_change_requests add column if not exists requested_changes jsonb;
alter table public.event_change_requests add column if not exists applied_changes jsonb;
alter table public.event_change_requests add column if not exists significant boolean;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'event_change_requests_requested_changes_check'
    ) then
        alter table public.event_change_requests
            add constraint event_change_requests_requested_changes_check check (
                requested_changes is null or (
                    jsonb_typeof(requested_changes) = 'object'
                    and requested_changes <> '{}'::jsonb
                    -- Only changeable event fields: nothing may remain once they are removed.
                    and requested_changes - array[
                        'title', 'description', 'purpose', 'category',
                        'expected_attendance', 'venue_requirements',
                        'accessibility_requirements', 'equipment_requirements',
                        'registration_requirements'
                    ] = '{}'::jsonb
                )
            );
    end if;
    if not exists (
        select 1 from pg_constraint where conname = 'event_change_requests_applied_check'
    ) then
        alter table public.event_change_requests
            add constraint event_change_requests_applied_check check (
                (applied_changes is null and significant is null)
                or (status in ('Approved', 'Implemented')
                    and jsonb_typeof(applied_changes) = 'object' and significant is not null)
            );
    end if;
end;
$$;

-- Approve one structured change request. Under the event row lock it re-checks the
-- Coordinator and both states, applies the proposed values, records the decision and
-- history, and notifies. Nothing is cancelled or un-booked: affected venue bookings and
-- equipment reservations are only counted for a manual re-check. Any failure rolls the
-- whole transaction back, leaving the event and the request unchanged.
create or replace function public.approve_change_request(
    p_event_id uuid, p_request_id bigint, p_actor_id integer, p_review_note text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
    actor public.app_users;
    previous public.events;
    saved public.events;
    pending public.event_change_requests;
    proposed jsonb;
    applied jsonb := '{}'::jsonb;
    field text;
    is_significant boolean;
    decision_note text := nullif(btrim(coalesce(p_review_note, '')), '');
    event_title text;
    affected_bookings integer;
    affected_reservations integer;
    changed_labels text;
begin
    if decision_note is not null and char_length(decision_note) > 2000 then
        raise sqlstate '22023' using message = 'Invalid review note';
    end if;

    select * into actor from public.app_users where id = p_actor_id;
    if not found or actor.role <> 'Coordinator' then
        raise sqlstate 'PT403' using message = 'Coordinator required';
    end if;

    select * into previous from public.events where id = p_event_id for update;
    if not found or previous.status = 'Draft' then
        raise sqlstate 'PT404' using message = 'Event not found';
    end if;
    if previous.coordinator_id is distinct from actor.id then
        raise sqlstate 'PT403' using message = 'Assigned coordinator required';
    end if;
    if previous.status in ('Completed', 'Cancelled', 'Rejected') then
        raise sqlstate 'PT409' using message = 'closed_event';
    end if;

    select * into pending from public.event_change_requests
    where id = p_request_id and event_id = p_event_id for update;
    if not found then
        raise sqlstate 'PT404' using message = 'Change request not found';
    end if;
    if pending.status not in ('Pending', 'Under Review') then
        raise sqlstate 'PT409' using message = 'already_reviewed';
    end if;
    proposed := pending.requested_changes;
    if proposed is null then
        raise sqlstate 'PT409' using message = 'nothing_to_apply';
    end if;

    update public.events e set
        title = case when proposed ? 'title' then proposed->>'title' else e.title end,
        description = case when proposed ? 'description'
            then proposed->>'description' else e.description end,
        purpose = case when proposed ? 'purpose' then proposed->>'purpose' else e.purpose end,
        category = case when proposed ? 'category' then proposed->>'category' else e.category end,
        expected_attendance = case when proposed ? 'expected_attendance'
            then (proposed->>'expected_attendance')::integer else e.expected_attendance end,
        venue_requirements = case when proposed ? 'venue_requirements'
            then proposed->>'venue_requirements' else e.venue_requirements end,
        accessibility_requirements = case when proposed ? 'accessibility_requirements'
            then proposed->>'accessibility_requirements' else e.accessibility_requirements end,
        equipment_requirements = case when proposed ? 'equipment_requirements'
            then proposed->>'equipment_requirements' else e.equipment_requirements end,
        registration_requirements = case when proposed ? 'registration_requirements'
            then proposed->>'registration_requirements' else e.registration_requirements end,
        updated_at = now()
    where e.id = p_event_id
    returning * into saved;

    -- Record only values that really changed (the event may have moved on since).
    for field in select jsonb_object_keys(proposed) loop
        if (to_jsonb(previous) -> field) is distinct from (to_jsonb(saved) -> field) then
            applied := applied || jsonb_build_object(field, jsonb_build_object(
                'from', to_jsonb(previous) -> field, 'to', to_jsonb(saved) -> field
            ));
        end if;
    end loop;
    -- Significant per the customer (S1 Q7, Q11): number of pax or venue.
    is_significant := applied ?| array['expected_attendance', 'venue_requirements'];

    update public.event_change_requests set
        status = 'Approved', reviewed_by = actor.id, reviewed_at = now(),
        review_note = decision_note,
        applied_changes = applied, significant = is_significant
    where id = pending.id
    returning * into pending;

    insert into public.event_status_history (
        event_id, old_status, new_status, changed_by, changed_at, action, note
    ) values (
        p_event_id, previous.status, previous.status, actor.id, pending.reviewed_at,
        'change_request_approved', decision_note
    );

    select count(*) into affected_bookings from public.venue_bookings
    where event_id = p_event_id and status in ('Requested', 'Pending', 'Held', 'Confirmed');
    select count(*) into affected_reservations from public.equipment_reservations
    where event_id = p_event_id and status in ('Reserved', 'Pending');

    event_title := coalesce(nullif(btrim(saved.title), ''), 'Untitled event');
    insert into public.notifications (recipient_id, event_id, notification_type, message)
    values (previous.organiser_id, p_event_id, 'event_change_request_updated',
            'Your change request for "' || event_title || '" was approved and applied.');

    if is_significant then
        select string_agg(replace(key, '_', ' '), ' and ' order by key) into changed_labels
        from jsonb_object_keys(applied) as key
        where key in ('expected_attendance', 'venue_requirements');
        insert into public.notifications (recipient_id, event_id, notification_type, message)
        values (actor.id, p_event_id, 'event_re_review_required',
                'Re-review "' || event_title || '": the approved change to ' || changed_labels
                || ' may affect ' || affected_bookings || ' venue booking(s) and '
                || affected_reservations || ' equipment reservation(s). Nothing was cancelled.');
    end if;

    return jsonb_build_object(
        'change_request', to_jsonb(pending),
        'event', to_jsonb(saved),
        'affected', jsonb_build_object(
            'venue_bookings', affected_bookings,
            'equipment_reservations', affected_reservations
        )
    );
end;
$$;

revoke all on function public.approve_change_request(uuid, bigint, integer, text)
    from public, anon, authenticated;
grant execute on function public.approve_change_request(uuid, bigint, integer, text)
    to service_role;

notify pgrst, 'reload schema';
commit;
