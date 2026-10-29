-- SCRUM-130 (Week 7 Change #5): submitted requests enter an unassigned queue and the
-- Event Coordinator Lead assigns / reassigns a Coordinator. Supersedes SCRUM-17's
-- auto-assignment (SCRUM-17 stays Done as historical work).
-- Apply after auto_assign_coordinator.sql, request_clarification.sql,
-- event_decision_notifications.sql and the SCRUM-131 Lead migration. Safe to rerun.
-- Existing assignments are kept; only new submissions stop being auto-assigned.
begin;

-- 1. Stop auto-assignment on submit. The old trigger also stamped the assignment
-- time; keep only that part, so any write that sets a Coordinator records when.
drop trigger if exists events_assign_coordinator on public.events;
drop function if exists public.assign_event_coordinator();

create or replace function public.stamp_coordinator_assignment()
returns trigger language plpgsql set search_path = '' as $$
begin
    if new.coordinator_id is null then
        new.coordinator_assigned_at = null;
    elsif tg_op = 'INSERT' then
        new.coordinator_assigned_at = coalesce(new.coordinator_assigned_at, now());
    elsif new.coordinator_id is distinct from old.coordinator_id
          and new.coordinator_assigned_at is not distinct from old.coordinator_assigned_at then
        -- A new Coordinator without an explicit time gets a fresh assignment time.
        new.coordinator_assigned_at = now();
    end if;
    return new;
end;
$$;

drop trigger if exists events_stamp_coordinator_assignment on public.events;
create trigger events_stamp_coordinator_assignment
    before insert or update of coordinator_id on public.events
    for each row execute function public.stamp_coordinator_assignment();

-- 2. The old invariant required every submitted request to have a Coordinator.
-- Replace it: an assignment always has a timestamp, and only a not-yet-decided
-- (Submitted) or Cancelled request may be unassigned.
alter table public.events drop constraint if exists events_submitted_assignment_check;
alter table public.events drop constraint if exists events_coordinator_assignment_check;
alter table public.events add constraint events_coordinator_assignment_check check (
    (coordinator_id is null or coordinator_assigned_at is not null)
    and (status in ('Draft', 'Submitted', 'Cancelled') or coordinator_id is not null)
);

-- The Lead's queue reads unassigned submitted requests, oldest first.
create index if not exists events_unassigned_queue_idx
    on public.events (submitted_at) where coordinator_id is null and status = 'Submitted';

-- 3. Assign or reassign in one transaction: the event row, the Coordinator's
-- membership, the history entry and both notifications succeed or roll back together.
create or replace function public.assign_coordinator_by_lead(
    p_event_id uuid, p_coordinator_id integer, p_lead_id integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
    lead public.app_users;
    coordinator public.app_users;
    previous public.events;
    saved public.events;
    assigned_at timestamptz := clock_timestamp();
    outcome text;
    event_title text;
begin
    select * into lead from public.app_users
    where id = p_lead_id and role = 'Event Coordinator Lead' for share;
    if not found then
        raise sqlstate 'PT403' using message = 'Event Coordinator Lead required';
    end if;

    select * into coordinator from public.app_users
    where id = p_coordinator_id and role = 'Coordinator' for share;
    if not found then
        raise sqlstate '22023' using message = 'not_a_coordinator';
    end if;

    -- Lock the event so two Leads (or an assignment and a decision) serialise.
    select * into previous from public.events where id = p_event_id for update;
    -- Drafts stay private to their Organiser, so they are indistinguishable from missing.
    if not found or previous.status = 'Draft' then
        raise sqlstate 'PT404' using message = 'Event not found';
    end if;
    if previous.status in ('Completed', 'Rejected', 'Cancelled') then
        raise sqlstate 'PT409' using message = 'closed';
    end if;
    if previous.coordinator_id is not distinct from p_coordinator_id then
        raise sqlstate 'PT409' using message = 'already_assigned';
    end if;

    outcome := case when previous.coordinator_id is null then 'assigned' else 'reassigned' end;
    event_title := coalesce(nullif(btrim(previous.title), ''), 'Untitled event request');

    update public.events set
        coordinator_id = p_coordinator_id,
        coordinator_assigned_at = assigned_at,
        updated_at = assigned_at
    where id = p_event_id returning * into saved;

    -- Event membership grants record access (require_related_user), so the previous
    -- Coordinator must lose it, not just stop being coordinator_id.
    if previous.coordinator_id is not null then
        delete from public.event_participants
        where event_id = p_event_id and user_id = previous.coordinator_id
          and role = 'Coordinator';
    end if;
    insert into public.event_participants (event_id, user_id, role)
    values (p_event_id, p_coordinator_id, 'Coordinator')
    on conflict (event_id, user_id) do nothing;

    -- Status is unchanged; the history entry records who routed the request to whom.
    insert into public.event_status_history (
        event_id, old_status, new_status, changed_by, changed_at, action, note
    ) values (
        p_event_id, previous.status, previous.status, lead.id, assigned_at,
        'coordinator_' || outcome,
        'Assigned to ' || coordinator.display_name
    );

    insert into public.notifications (recipient_id, event_id, notification_type, message)
    values (p_coordinator_id, p_event_id, 'coordinator_assigned',
            'You have been assigned the event request "' || event_title || '".');
    -- The Organiser learns once that the request has left the Lead's queue; later
    -- moves between Coordinators are internal routing and are not relayed.
    if previous.coordinator_id is null then
        insert into public.notifications (recipient_id, event_id, notification_type, message)
        values (previous.organiser_id, p_event_id, 'request_assigned',
                'A Coordinator has been assigned to your request "' || event_title
                || '" and will review it.');
    end if;
    if previous.coordinator_id is not null then
        insert into public.notifications (recipient_id, event_id, notification_type, message)
        values (previous.coordinator_id, p_event_id, 'coordinator_unassigned',
                'The event request "' || event_title
                || '" has been reassigned to another Coordinator.');
    end if;

    return jsonb_build_object(
        'event', to_jsonb(saved),
        'outcome', outcome,
        'previous_coordinator_id', previous.coordinator_id
    );
end;
$$;

revoke all on function public.assign_coordinator_by_lead(uuid, integer, integer)
    from public, anon, authenticated;
grant execute on function public.assign_coordinator_by_lead(uuid, integer, integer)
    to service_role;

notify pgrst, 'reload schema';

commit;
