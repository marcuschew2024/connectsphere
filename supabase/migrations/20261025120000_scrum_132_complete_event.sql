-- SCRUM-132: complete and close a delivered event in one transaction.
-- Apply after the event, venue booking, equipment request and equipment reservation
-- migrations. Safe to rerun.
begin;

create or replace function public.complete_event(
    p_event_id uuid, p_actor_id integer, p_note text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
    actor public.app_users;
    previous public.events;
    saved public.events;
    completed_at timestamptz := clock_timestamp();
    released_equipment integer;
    released_bookings integer;
begin
    if p_note is not null and char_length(btrim(p_note)) > 2000 then
        raise sqlstate '22023' using message = 'Invalid completion note';
    end if;
    select * into actor from public.app_users
    where id = p_actor_id and role = 'Coordinator' for share;
    if not found then raise sqlstate 'PT403' using message = 'Coordinator required'; end if;

    -- Lock the event so two completions (or a completion and a status change) serialise.
    select * into previous from public.events where id = p_event_id for update;
    if not found then raise sqlstate 'PT404' using message = 'Event not found'; end if;
    if previous.coordinator_id is distinct from actor.id then
        raise sqlstate 'PT403' using message = 'Assigned coordinator required';
    end if;
    if previous.status = 'Completed' then
        raise sqlstate 'PT409' using message = 'already_completed';
    end if;
    if previous.status <> 'Preparation' then
        raise sqlstate 'PT409' using message = 'not_in_preparation';
    end if;
    if exists (
        select 1 from public.venue_bookings
        where event_id = p_event_id and status in ('Requested', 'Pending')
    ) then
        raise sqlstate 'PT409' using message = 'pending_bookings';
    end if;
    if exists (
        select 1 from public.equipment_requests
        where event_id = p_event_id and status = 'Requested'
    ) then
        raise sqlstate 'PT409' using message = 'open_equipment_requests';
    end if;

    update public.events set
        status = 'Completed',
        last_status_changed_by = actor.id,
        last_status_changed_at = completed_at
    where id = p_event_id returning * into saved;

    insert into public.event_status_history (
        event_id, old_status, new_status, changed_by, changed_at, action, note
    ) values (
        p_event_id, previous.status, 'Completed', actor.id, completed_at,
        'event_completed', nullif(btrim(coalesce(p_note, '')), '')
    );

    -- Release remaining holds. Past confirmed bookings stay as the delivery record;
    -- confirmed bookings for slots that have not ended yet no longer need the venue.
    update public.equipment_reservations set status = 'Released', updated_at = completed_at
    where event_id = p_event_id and status in ('Reserved', 'Pending');
    get diagnostics released_equipment = row_count;

    update public.venue_bookings set
        status = 'Cancelled',
        updated_at = completed_at,
        last_changed_by = actor.id,
        last_changed_at = completed_at
    where event_id = p_event_id and status = 'Confirmed' and end_at > completed_at;
    get diagnostics released_bookings = row_count;

    return jsonb_build_object(
        'event', to_jsonb(saved),
        'released_equipment_reservations', released_equipment,
        'released_venue_bookings', released_bookings
    );
end;
$$;

revoke all on function public.complete_event(uuid, integer, text)
    from public, anon, authenticated;
grant execute on function public.complete_event(uuid, integer, text) to service_role;

notify pgrst, 'reload schema';

commit;
