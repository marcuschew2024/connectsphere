-- SCRUM-135: only the current Coordinator advances intake. Re-check under the
-- same event lock used by reassignment/cancellation; audit and notify atomically.
begin;
-- A stale dedicated action must not resurrect an event closed concurrently.
create or replace function public.keep_terminal_event_status()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
    if old.status in ('Rejected', 'Cancelled', 'Completed')
       and new.status is distinct from old.status then
        raise sqlstate 'PT409' using message = 'terminal_event_is_closed';
    end if;
    return new;
end;
$$;
revoke all on function public.keep_terminal_event_status() from public, anon, authenticated;
drop trigger if exists events_keep_terminal_status on public.events;
create trigger events_keep_terminal_status before update of status on public.events
for each row execute function public.keep_terminal_event_status();

create or replace function public.transition_event_intake(
    p_event_id uuid, p_expected_status text, p_status text, p_actor_id integer,
    p_reason text default null
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
    previous public.events%rowtype;
    saved public.events%rowtype;
    changed_at timestamptz := clock_timestamp();
begin
    select * into previous from public.events where id = p_event_id for update;
    if not found then
        raise sqlstate 'PT404' using message = 'event_not_found';
    end if;
    if p_actor_id is null or previous.coordinator_id is distinct from p_actor_id
       or not exists (select 1 from public.app_users where id = p_actor_id and role = 'Coordinator') then
        raise sqlstate 'PT403' using message = 'not_current_coordinator';
    end if;
    if previous.status is distinct from p_expected_status or not coalesce(
        (previous.status = 'Submitted' and p_status in ('Assigned', 'Under review', 'Planning', 'Rejected'))
        or (previous.status = 'Assigned' and p_status in ('Under review', 'Planning', 'Rejected'))
        or (previous.status in ('Under review', 'Approved') and p_status in ('Planning', 'Rejected')),
        false
    ) then
        raise sqlstate 'PT409' using message = 'invalid_transition';
    end if;
    if exists (select 1 from public.event_clarifications
               where event_id = p_event_id and status = 'Pending') then
        raise sqlstate 'PT409' using message = 'awaiting_organiser_resubmission';
    end if;
    if p_status = 'Rejected' and
       (nullif(btrim(p_reason), '') is null or char_length(btrim(p_reason)) > 2000) then
        raise sqlstate '22023' using message = 'rejection_reason_required';
    end if;
    update public.events set status = p_status, updated_at = changed_at,
        last_status_changed_by = p_actor_id, last_status_changed_at = changed_at,
        decision_by = case when p_status in ('Planning', 'Rejected') then p_actor_id else decision_by end,
        decision_at = case when p_status in ('Planning', 'Rejected') then changed_at else decision_at end,
        decision_reason = case when p_status = 'Rejected' then btrim(p_reason)
                               when p_status = 'Planning' then null else decision_reason end
    where id = p_event_id returning * into saved;
    insert into public.event_status_history(event_id, old_status, new_status, changed_by, changed_at)
    values (p_event_id, previous.status, p_status, p_actor_id, changed_at);
    if p_status in ('Planning', 'Rejected') then
        insert into public.notifications(recipient_id, event_id, notification_type, message)
        values (previous.organiser_id, p_event_id,
            case when p_status = 'Rejected' then 'event_rejected' else 'event_approved' end,
            case when p_status = 'Rejected' then 'Your event request was rejected: ' || btrim(p_reason)
                 else 'Your event request was accepted by the Coordinator and is now in Planning.' end);
    end if;
    return jsonb_build_object('event', to_jsonb(saved));
end;
$$;
revoke all on function public.transition_event_intake(uuid, text, text, integer, text)
    from public, anon, authenticated;
grant execute on function public.transition_event_intake(uuid, text, text, integer, text)
    to service_role;
notify pgrst, 'reload schema';
commit;
