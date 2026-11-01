-- Event end time: the Organiser now gives a start AND an end time for the event.
--
-- Before this, an event stored only event_datetime (the start), so the Coordinator
-- had to guess the end when booking a venue or reserving equipment. This adds
-- event_end_datetime and lets those bookings pre-fill from it. Ties into the event
-- request (SCRUM-15) and reschedule (SCRUM-48) scope. Run after create_events.sql.
-- Safe to rerun. Run after 20261101123000_scrum_158_split_facility_requirements.sql.
begin;

alter table public.events
    add column if not exists event_end_datetime timestamptz;

-- End-after-start and required-on-submit are enforced in the app layer
-- (event_validation.py), NOT as a DB CHECK: the existing reschedule
-- (approve_change_request, SCRUM-48) moves event_datetime without touching the end,
-- so a hard order constraint could reject a valid reschedule. A duration-preserving
-- reschedule (shift the end by the same delta) is the recommended follow-up.

-- Redefine save_event_draft to persist the end time. Based on the create_events.sql
-- version so other fields are unchanged.
create or replace function public.save_event_draft(
    p_event_id uuid,
    p_organiser_id integer,
    p_details jsonb,
    p_submit boolean default false
)
returns setof public.events
language plpgsql security invoker set search_path = '' as $$
declare
    saved public.events;
begin
    update public.events
    set title = p_details ->> 'title',
        description = p_details ->> 'description',
        purpose = p_details ->> 'purpose',
        category = p_details ->> 'category',
        event_datetime = (p_details ->> 'event_datetime')::timestamptz,
        event_end_datetime = (p_details ->> 'event_end_datetime')::timestamptz,
        expected_attendance = (p_details ->> 'expected_attendance')::integer,
        venue_requirements = p_details ->> 'venue_requirements',
        facility_requirements = p_details ->> 'facility_requirements',
        accessibility_requirements = p_details ->> 'accessibility_requirements',
        equipment_requirements = p_details ->> 'equipment_requirements',
        registration_requirements = p_details ->> 'registration_requirements',
        status = case when p_submit then 'Submitted' else 'Draft' end,
        submitted_at = case when p_submit then now() else null end,
        last_status_changed_by = case when p_submit then p_organiser_id
                                      else last_status_changed_by end,
        last_status_changed_at = case when p_submit then now()
                                      else last_status_changed_at end
    where id = p_event_id and organiser_id = p_organiser_id and status = 'Draft'
    returning * into saved;

    if not found then
        return;
    end if;

    if p_submit then
        insert into public.event_participants (event_id, user_id, role)
        select saved.id, saved.coordinator_id, 'Coordinator'
        where saved.coordinator_id is not null
        on conflict (event_id, user_id) do nothing;
        insert into public.event_status_history (event_id, old_status, new_status, changed_by)
        values (saved.id, 'Draft', 'Submitted', p_organiser_id);
    end if;
    return next saved;
end;
$$;

revoke all on function public.save_event_draft(uuid, integer, jsonb, boolean)
    from public, anon, authenticated;
grant execute on function public.save_event_draft(uuid, integer, jsonb, boolean) to service_role;

commit;
