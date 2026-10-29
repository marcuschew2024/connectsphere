-- SCRUM-40. Apply after SCRUM-41 and event_decision_notifications.sql.
-- Additive, replay-safe; no shared data or existing registration is rewritten.
begin;

-- SCRUM-42 will own editing these optional bounds. NULL means unbounded, preserving
-- the existing Confirmed + configured-capacity opening rule until a period is set.
alter table public.events
    add column if not exists registration_opens_at timestamptz,
    add column if not exists registration_closes_at timestamptz;
alter table public.events drop constraint if exists events_registration_period_check;
alter table public.events add constraint events_registration_period_check check (
    registration_opens_at is null or registration_closes_at is null
    or registration_closes_at >= registration_opens_at
);
alter table public.event_registrations
    add column if not exists information text not null default ''
        check (char_length(information) <= 4000);

create or replace function public.guard_registration_eligibility()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
    event public.events;
    checked_at timestamptz;
begin
    if tg_op = 'UPDATE' then
        -- Submitted information is an immutable receipt, not a profile editor.
        if new.information is distinct from old.information then
            raise sqlstate '22023' using message = 'Registration information is immutable';
        end if;
        if new.status = old.status or new.status <> 'Registered' then return new; end if;
    end if;
    -- The capacity guard locks this same row first. Check wall time AFTER any wait
    -- so a request queued before closing cannot succeed after the window closes.
    select * into event from public.events where id = new.event_id for update;
    checked_at := clock_timestamp();
    if event.registration_opens_at is not null and checked_at < event.registration_opens_at then
        raise sqlstate 'PT409' using message = 'registration_not_open';
    end if;
    if event.registration_closes_at is not null and checked_at >= event.registration_closes_at then
        raise sqlstate 'PT409' using message = 'registration_ended';
    end if;
    new.information := btrim(new.information);
    if char_length(new.information) > 4000 then
        raise sqlstate '22023' using message = 'registration_information_too_long';
    end if;
    if coalesce(event.registration_requirements, '') ~ '[^[:space:]]'
        and new.information !~ '[^[:space:]]' then
        raise sqlstate '22023' using message = 'registration_information_required';
    end if;
    return new;
end;
$$;

create or replace trigger event_registrations_eligibility_guard
    before insert or update on public.event_registrations
    for each row execute function public.guard_registration_eligibility();

create or replace function public.record_registration_receipt()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare event public.events;
begin
    select * into event from public.events where id = new.event_id;
    insert into public.event_participants (event_id, user_id, role)
    values (new.event_id, new.attendee_id, 'Attendee')
    on conflict (event_id, user_id) do nothing;
    insert into public.notifications (recipient_id, event_id, notification_type, message)
    values (new.attendee_id, new.event_id, 'registration_confirmed',
        'Your place is booked for ' || coalesce(event.title, 'this event') || '.'
        || case when event.event_datetime is null then '' else ' Event time: '
            || to_char(event.event_datetime at time zone 'Asia/Singapore',
                       'DD Mon YYYY HH24:MI') || ' (Singapore).' end
        || ' Open the event for its details and your registration reference.');
    return new;
end;
$$;

create or replace trigger event_registrations_receipt
    after insert on public.event_registrations
    for each row execute function public.record_registration_receipt();

-- Keep SCRUM-41's two-argument RPC and {} HTTP clients working. Both RPCs pass
-- through the same table guards and atomically create access and confirmation.
create or replace function public.register_event_attendee_with_information(
    p_event_id uuid, p_attendee_id integer, p_information text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare registration public.event_registrations;
begin
    insert into public.event_registrations (event_id, attendee_id, information)
    values (p_event_id, p_attendee_id, coalesce(p_information, ''))
    returning * into registration;
    return to_jsonb(registration);
end;
$$;

revoke all on function public.guard_registration_eligibility() from public, anon, authenticated;
revoke all on function public.record_registration_receipt() from public, anon, authenticated;
revoke all on function public.register_event_attendee_with_information(uuid, integer, text)
    from public, anon, authenticated;
grant execute on function public.register_event_attendee_with_information(uuid, integer, text)
    to service_role;

notify pgrst, 'reload schema';
commit;
