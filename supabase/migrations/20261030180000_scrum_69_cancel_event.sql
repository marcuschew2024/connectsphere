-- SCRUM-69: cancel an event, release its resources and notify the people affected,
-- all in one transaction. Apply after the event, venue booking, equipment reservation,
-- registration (SCRUM-40/41), Event Coordinator Lead (SCRUM-131) and notification
-- recipient (SCRUM-49) migrations. Safe to rerun.
begin;

create or replace function public.cancel_event(
    p_event_id uuid, p_actor_id integer, p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
    actor public.app_users;
    previous public.events;
    saved public.events;
    cancelled_at timestamptz := clock_timestamp();
    reason text := btrim(coalesce(p_reason, ''));
    event_title text;
    released_equipment integer;
    released_bookings integer;
    notified_attendees integer;
begin
    if char_length(reason) not between 1 and 2000 then
        raise sqlstate '22023' using message = 'Invalid cancellation reason';
    end if;
    select * into actor from public.app_users
    where id = p_actor_id and role in ('Coordinator', 'Event Coordinator Lead') for share;
    if not found then raise sqlstate 'PT403' using message = 'Coordinator or Lead required'; end if;

    -- Lock the event so a cancellation serialises with completion, assignment and
    -- other cancellations of the same event.
    select * into previous from public.events where id = p_event_id for update;
    if not found or previous.status = 'Draft' then
        raise sqlstate 'PT404' using message = 'Event not found';
    end if;
    if actor.role = 'Coordinator' and previous.coordinator_id is distinct from actor.id then
        raise sqlstate 'PT403' using message = 'Assigned coordinator required';
    end if;
    if previous.status = 'Cancelled' then
        raise sqlstate 'PT409' using message = 'already_cancelled';
    end if;
    if previous.status not in (
        'Submitted', 'Assigned', 'Under review', 'Under Review', 'Approved',
        'Planning', 'Confirmed', 'Preparation'
    ) then
        raise sqlstate 'PT409' using message = 'closed_event';
    end if;

    -- Release resources first so the counts below are this transaction's own work
    -- (the older equipment trigger on Cancelled then finds nothing left to release).
    update public.equipment_reservations set status = 'Released', updated_at = cancelled_at
    where event_id = p_event_id and status in ('Reserved', 'Pending');
    get diagnostics released_equipment = row_count;

    update public.venue_bookings set
        status = 'Cancelled',
        updated_at = cancelled_at,
        last_changed_by = actor.id,
        last_changed_at = cancelled_at
    where event_id = p_event_id and status in ('Requested', 'Pending', 'Held', 'Confirmed');
    get diagnostics released_bookings = row_count;

    update public.events set
        status = 'Cancelled',
        last_status_changed_by = actor.id,
        last_status_changed_at = cancelled_at
    where id = p_event_id returning * into saved;

    insert into public.event_status_history (
        event_id, old_status, new_status, changed_by, changed_at, action, note
    ) values (
        p_event_id, previous.status, 'Cancelled', actor.id, cancelled_at,
        'event_cancelled', reason
    );

    event_title := coalesce(nullif(btrim(previous.title), ''), 'Untitled event');

    -- Registered Attendees learn the event is off. Registrations themselves stay as
    -- they are: cancellation is not an attendee withdrawal (Decision Log D31).
    -- The message names only the event, never internal planning detail.
    insert into public.notifications (recipient_id, event_id, notification_type, message)
    select r.attendee_id, p_event_id, 'event_cancelled',
           'The event "' || event_title || '" you registered for has been cancelled.'
    from public.event_registrations r
    where r.event_id = p_event_id and r.status = 'Registered';
    get diagnostics notified_attendees = row_count;

    insert into public.notifications (recipient_id, event_id, notification_type, message)
    values (previous.organiser_id, p_event_id, 'event_cancelled',
            'Your event "' || event_title || '" has been cancelled. Reason: ' || reason);

    if previous.coordinator_id is not null and previous.coordinator_id <> actor.id then
        insert into public.notifications (recipient_id, event_id, notification_type, message)
        values (previous.coordinator_id, p_event_id, 'event_cancelled',
                'The event "' || event_title
                || '" assigned to you was cancelled by the Event Coordinator Lead.');
    end if;

    return jsonb_build_object(
        'event', to_jsonb(saved),
        'released_equipment_reservations', released_equipment,
        'released_venue_bookings', released_bookings,
        'notified_attendees', notified_attendees
    );
end;
$$;

revoke all on function public.cancel_event(uuid, integer, text)
    from public, anon, authenticated;
grant execute on function public.cancel_event(uuid, integer, text) to service_role;

notify pgrst, 'reload schema';

commit;
