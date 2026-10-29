-- SCRUM-40 review fix: an unset limit must not strand an already Confirmed event.
-- Apply after SCRUM-41. No event values or lifecycle statuses are changed here.
begin;

create or replace function public.set_registration_capacity(
    p_event_id uuid, p_actor_id integer, p_capacity integer
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare event public.events;
begin
    if p_capacity is null or p_capacity < 1 then
        raise sqlstate '22023' using message = 'Invalid capacity';
    end if;
    perform 1 from public.app_users where id = p_actor_id and role = 'Organiser';
    if not found then raise sqlstate 'PT403' using message = 'Organiser required'; end if;
    select * into event from public.events where id = p_event_id for update;
    if not found then raise sqlstate 'PT404' using message = 'Event not found'; end if;
    if event.organiser_id <> p_actor_id then
        raise sqlstate 'PT403' using message = 'Event owner required';
    end if;
    if event.status not in ('Draft', 'Submitted', 'Assigned', 'Under review', 'Approved', 'Planning')
        and not (event.status = 'Confirmed' and event.registration_capacity is null
                 and event.registered_count = 0) then
        raise sqlstate 'PT409' using message = 'capacity_locked';
    end if;
    if p_capacity < event.registered_count then
        raise sqlstate 'PT409' using message = 'capacity_below_registrations';
    end if;
    if event.registration_capacity is distinct from p_capacity then
        update public.events set registration_capacity = p_capacity
        where id = p_event_id returning * into event;
        insert into public.event_edit_log (event_id, editor_id, changed_fields, importance)
        values (p_event_id, p_actor_id, array['registration_capacity'], 'important');
    end if;
    return to_jsonb(event);
end;
$$;

revoke all on function public.set_registration_capacity(uuid, integer, integer)
    from public, anon, authenticated;
grant execute on function public.set_registration_capacity(uuid, integer, integer) to service_role;
notify pgrst, 'reload schema';
commit;
