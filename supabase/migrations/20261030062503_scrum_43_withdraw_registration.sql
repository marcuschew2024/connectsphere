-- SCRUM-43. Apply after SCRUM-40 and SCRUM-49. Additive and replay-safe.
begin;

alter table public.events
    add column if not exists withdrawal_closes_at timestamptz;

-- Capacity and eligibility guards run first (alphabetical trigger order), locking
-- the parent event and stamping withdrawal. A refusal rolls those changes back.
-- Applies to direct backend UPDATEs too, not only the HTTP/RPC entry point.
create or replace function public.guard_registration_withdrawal()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare event public.events; checked_at timestamptz;
begin
    if old.status <> 'Registered' or new.status <> 'Withdrawn' then return new; end if;
    select * into event from public.events where id = new.event_id for update;
    checked_at := clock_timestamp();
    if event.status not in ('Confirmed', 'Preparation') or event.event_datetime is null
        or checked_at >= event.event_datetime then
        raise sqlstate 'PT409' using message = 'withdrawal_closed';
    end if;
    if event.withdrawal_closes_at is not null and checked_at >= event.withdrawal_closes_at then
        raise sqlstate 'PT409' using message = 'withdrawal_deadline_passed';
    end if;
    return new;
end;
$$;
create or replace trigger event_registrations_withdrawal_guard
    before update on public.event_registrations
    for each row execute function public.guard_registration_withdrawal();

create or replace function public.record_registration_withdrawal()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare event public.events;
begin
    if old.status = 'Registered' and new.status = 'Withdrawn' then
        select * into event from public.events where id = new.event_id;
        insert into public.notifications (recipient_id, event_id, notification_type, message)
        values (new.attendee_id, new.event_id, 'registration_withdrawn',
            'Your registration for ' || coalesce(event.title, 'this event')
            || ' has been withdrawn. Your place has been released.');
    end if;
    return new;
end;
$$;
create or replace trigger event_registrations_withdrawal_receipt
    after update on public.event_registrations
    for each row execute function public.record_registration_withdrawal();

create or replace function public.withdraw_event_attendee(p_event_id uuid, p_attendee_id integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare registration public.event_registrations;
begin
    perform 1 from public.app_users where id = p_attendee_id and role = 'Attendee';
    if not found then raise sqlstate 'PT403' using message = 'Attendee required'; end if;
    -- Registration first, then the parent via its trigger: consistent with direct
    -- UPDATE locking. Repeated/concurrent withdrawal returns the original receipt.
    select * into registration from public.event_registrations
    where event_id = p_event_id and attendee_id = p_attendee_id for update;
    if not found then raise sqlstate 'PT404' using message = 'Registration not found'; end if;
    if registration.status <> 'Withdrawn' then
        update public.event_registrations set status = 'Withdrawn'
        where id = registration.id returning * into registration;
    end if;
    return jsonb_build_object('id', registration.id, 'event_id', registration.event_id,
        'status', registration.status, 'registered_at', registration.registered_at,
        'withdrawn_at', registration.withdrawn_at);
end;
$$;

create or replace function public.get_event_withdrawal_policy(p_event_id uuid, p_actor_id integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare event public.events; editable boolean;
begin
    perform 1 from public.app_users where id = p_actor_id and role = 'Organiser';
    if not found then raise sqlstate 'PT403' using message = 'Organiser required'; end if;
    select * into event from public.events where id = p_event_id;
    if not found then raise sqlstate 'PT404' using message = 'Event not found'; end if;
    if event.organiser_id <> p_actor_id then
        raise sqlstate 'PT403' using message = 'Event owner required';
    end if;
    editable := event.status in ('Draft', 'Submitted', 'Assigned', 'Under review',
                                'Approved', 'Planning', 'Confirmed')
        and (event.event_datetime is null or clock_timestamp() < event.event_datetime)
        and not exists (select 1 from public.event_registrations where event_id = p_event_id);
    return jsonb_build_object('closes_at', event.withdrawal_closes_at, 'can_edit', editable);
end;
$$;

create or replace function public.set_event_withdrawal_policy(
    p_event_id uuid, p_actor_id integer, p_closes_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare event public.events; policy jsonb;
begin
    -- Serialize against signup before checking whether conditions are still editable.
    select * into event from public.events where id = p_event_id for update;
    policy := public.get_event_withdrawal_policy(p_event_id, p_actor_id);
    if not (policy->>'can_edit')::boolean then
        raise sqlstate 'PT409' using message = 'withdrawal_policy_locked';
    end if;
    if p_closes_at is not null and (event.event_datetime is null
        or p_closes_at > event.event_datetime or p_closes_at <= clock_timestamp()) then
        raise sqlstate '22023' using message = 'invalid_withdrawal_policy';
    end if;
    if event.withdrawal_closes_at is distinct from p_closes_at then
        update public.events set withdrawal_closes_at = p_closes_at
        where id = p_event_id;
        insert into public.event_edit_log (event_id, editor_id, changed_fields, importance)
        values (p_event_id, p_actor_id, array['withdrawal_closes_at'], 'important');
    end if;
    return public.get_event_withdrawal_policy(p_event_id, p_actor_id);
end;
$$;

revoke all on function public.guard_registration_withdrawal() from public, anon, authenticated;
revoke all on function public.record_registration_withdrawal() from public, anon, authenticated;
revoke all on function public.withdraw_event_attendee(uuid, integer) from public, anon, authenticated;
revoke all on function public.get_event_withdrawal_policy(uuid, integer)
    from public, anon, authenticated;
revoke all on function public.set_event_withdrawal_policy(uuid, integer, timestamptz)
    from public, anon, authenticated;
grant execute on function public.withdraw_event_attendee(uuid, integer) to service_role;
grant execute on function public.get_event_withdrawal_policy(uuid, integer) to service_role;
grant execute on function public.set_event_withdrawal_policy(uuid, integer, timestamptz)
    to service_role;
notify pgrst, 'reload schema';
commit;
