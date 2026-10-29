-- SCRUM-129: Add configurable setup and turnaround times to venues.
-- Setup and turnaround buffers are measured in non-negative minutes.
begin;

alter table public.venues
    add column if not exists setup_time_minutes integer not null default 0
        check (setup_time_minutes >= 0 and setup_time_minutes <= 1440),
    add column if not exists turnaround_time_minutes integer not null default 0
        check (turnaround_time_minutes >= 0 and turnaround_time_minutes <= 1440);

-- Update the venue update RPC to support the 7 editable venue fields (5 existing + 2 buffers).
create or replace function public.update_venue_details(
    p_venue_id uuid, p_details jsonb, p_actor_id integer, p_revision integer
) returns setof public.venues
language plpgsql security definer set search_path = '' as $$
declare
    previous public.venues;
    saved public.venues;
    v_setup integer := 0;
    v_turnaround integer := 0;
begin
    if not exists (select 1 from public.app_users where id = p_actor_id and role = 'Venue Staff') then
        raise sqlstate 'PT403' using message = 'Venue Staff required';
    end if;
    select * into previous from public.venues where id = p_venue_id for update;
    if not found then raise sqlstate 'PT404' using message = 'Venue not found'; end if;
    if p_revision is distinct from previous.revision then
        raise sqlstate 'PT409' using message = 'Venue changed since it was loaded';
    end if;
    if jsonb_typeof(p_details) is distinct from 'object'
        or not (p_details ?& array['capacity','facilities','accessibility','supported_layouts','operating_hours']) then
        raise sqlstate '22023' using message = 'Invalid venue fields';
    end if;

    if p_details ? 'setup_time_minutes' and p_details->>'setup_time_minutes' is not null then
        v_setup := (p_details->>'setup_time_minutes')::integer;
    else
        v_setup := coalesce(previous.setup_time_minutes, 0);
    end if;

    if p_details ? 'turnaround_time_minutes' and p_details->>'turnaround_time_minutes' is not null then
        v_turnaround := (p_details->>'turnaround_time_minutes')::integer;
    else
        v_turnaround := coalesce(previous.turnaround_time_minutes, 0);
    end if;

    update public.venues set
        capacity = (p_details->>'capacity')::integer,
        facilities = array(select jsonb_array_elements_text(p_details->'facilities')),
        accessibility = array(select jsonb_array_elements_text(p_details->'accessibility')),
        supported_layouts = array(select jsonb_array_elements_text(p_details->'supported_layouts')),
        operating_hours = p_details->'operating_hours',
        setup_time_minutes = v_setup,
        turnaround_time_minutes = v_turnaround,
        revision = revision + 1, updated_at = now()
    where id = p_venue_id returning * into saved;

    insert into public.venue_update_history (venue_id, actor_id, changed_at, before_details, after_details)
        values (p_venue_id, p_actor_id, saved.updated_at, to_jsonb(previous), to_jsonb(saved));
    return next saved;
end;
$$;

revoke all on function public.update_venue_details(uuid, jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.update_venue_details(uuid, jsonb, integer, integer) to service_role;
notify pgrst, 'reload schema';

commit;
