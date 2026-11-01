-- SCRUM-48: rescheduling an event through a change request.
--
-- Makes date/time a requestable, significant change field. Replaces the SCRUM-156 version
-- of approve_change_request, PRESERVING the SCRUM-152 too-small venue re-check and the
-- SCRUM-156 re-review presentation, and adding: event_datetime applied on approval, counted
-- as significant, and a reschedule notice to registered attendees (US-11.3, S1 Q20). Nothing
-- is cancelled or un-booked; the SCRUM-159 confirmation gate blocks re-confirmation until the
-- venue booking(s) match the new date, so arrangements are reconsidered (core feature #19,
-- Section-G6 S1 Q28). Run after 20261031190000_scrum_156_re_review_presentation.sql.
-- Safe to rerun.
begin;

-- Allow event_datetime among the structured, requestable change fields.
do $$
begin
    if exists (
        select 1 from pg_constraint where conname = 'event_change_requests_requested_changes_check'
    ) then
        alter table public.event_change_requests
            drop constraint event_change_requests_requested_changes_check;
    end if;
    alter table public.event_change_requests
        add constraint event_change_requests_requested_changes_check check (
            requested_changes is null or (
                jsonb_typeof(requested_changes) = 'object'
                and requested_changes <> '{}'::jsonb
                and requested_changes - array[
                    'title', 'description', 'purpose', 'category',
                    'expected_attendance', 'venue_requirements',
                    'accessibility_requirements', 'equipment_requirements',
                    'registration_requirements', 'event_datetime'
                ] = '{}'::jsonb
            )
        );
end;
$$;

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
    too_small jsonb := '[]'::jsonb;
    too_small_text text;
    notified_attendees integer := 0;
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
        event_datetime = case when proposed ? 'event_datetime'
            then (proposed->>'event_datetime')::timestamptz else e.event_datetime end,
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
    -- Significant per the customer (S1 Q7, Q11): number of pax, venue, or date/time (SCRUM-48).
    is_significant := applied ?| array['expected_attendance', 'venue_requirements', 'event_datetime'];

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
        case when is_significant then 'change_request_approved_re_review'
             else 'change_request_approved' end,
        decision_note
    );

    select count(*) into affected_bookings from public.venue_bookings
    where event_id = p_event_id and status in ('Requested', 'Pending', 'Held', 'Confirmed');
    select count(*) into affected_reservations from public.equipment_reservations
    where event_id = p_event_id and status in ('Reserved', 'Pending');

    -- SCRUM-152: re-check each active booking's venue against the new attendance.
    if applied ? 'expected_attendance' then
        select coalesce(jsonb_agg(jsonb_build_object(
                   'booking_id', b.id, 'venue_name', v.name, 'capacity', v.capacity
               ) order by v.name), '[]'::jsonb),
               string_agg(v.name || ' (capacity ' || v.capacity || ')', ', ' order by v.name)
        into too_small, too_small_text
        from public.venue_bookings b join public.venues v on v.id = b.venue_id
        where b.event_id = p_event_id
          and b.status in ('Requested', 'Pending', 'Held', 'Confirmed')
          and v.capacity < saved.expected_attendance;
    end if;

    event_title := coalesce(nullif(btrim(saved.title), ''), 'Untitled event');

    -- SCRUM-156: a significant change is applied but still under re-review; say so.
    insert into public.notifications (recipient_id, event_id, notification_type, message)
    values (previous.organiser_id, p_event_id, 'event_change_request_updated',
            'Your change request for "' || event_title || '" was approved and applied.'
            || case when not is_significant then ''
                    else ' Because it changes the number of attendees or the venue, the '
                         || 'Coordinator is re-reviewing the venue and equipment arrangements.'
               end
            || case when too_small_text is null then ''
                    else ' The booked venue is too small for ' || saved.expected_attendance
                         || ' attendees: ' || too_small_text || '. Your Coordinator will '
                         || 're-book a larger venue, or you can raise a new change request.'
               end);

    if is_significant then
        select string_agg(replace(key, '_', ' '), ' and ' order by key) into changed_labels
        from jsonb_object_keys(applied) as key
        where key in ('expected_attendance', 'venue_requirements', 'event_datetime');
        insert into public.notifications (recipient_id, event_id, notification_type, message)
        values (actor.id, p_event_id, 'event_re_review_required',
                'Re-review "' || event_title || '": the approved change to ' || changed_labels
                || ' may affect ' || affected_bookings || ' venue booking(s) and '
                || affected_reservations || ' equipment reservation(s). Nothing was cancelled.'
                || case when too_small_text is null then ''
                        else ' Venue too small for ' || saved.expected_attendance
                             || ' attendees: ' || too_small_text || '.' end);
    end if;

    -- SCRUM-48: tell registered attendees when the date/time actually moved (US-11.3, S1 Q20).
    if applied ? 'event_datetime' then
        insert into public.notifications (recipient_id, event_id, notification_type, message)
        select r.attendee_id, p_event_id, 'event_rescheduled',
               'The event "' || event_title || '" has been rescheduled. '
               || 'Please check its new date and time.'
        from public.event_registrations r
        where r.event_id = p_event_id and r.status = 'Registered';
        get diagnostics notified_attendees = row_count;
    end if;

    return jsonb_build_object(
        'change_request', to_jsonb(pending),
        'event', to_jsonb(saved),
        'affected', jsonb_build_object(
            'venue_bookings', affected_bookings,
            'equipment_reservations', affected_reservations,
            'over_capacity', too_small,
            'notified_attendees', notified_attendees
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
