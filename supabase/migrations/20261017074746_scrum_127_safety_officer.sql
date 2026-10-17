-- SCRUM-127: run after seed_users.sql and create_events.sql.
-- Safe to rerun. Never assumes that user ID 6 is free.
begin;
lock table public.app_users in access exclusive mode;

alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (
    role in ('Organiser', 'Coordinator', 'Venue Staff', 'Tech Support', 'Attendee', 'Safety Officer')
);

-- Explicit IDs may already have been inserted without advancing the identity sequence.
-- Keep its high-water mark and all existing identities, then allocate a fresh ID.
select setval(
    pg_get_serial_sequence('public.app_users', 'id'),
    greatest((select coalesce(max(id), 1) from public.app_users),
             coalesce(pg_sequence_last_value(pg_get_serial_sequence('public.app_users', 'id')::regclass), 1)),
    true
);
insert into public.app_users (display_name, role, is_demo)
select 'Demo Safety Officer', 'Safety Officer', true
where not exists (
    select 1 from public.app_users where role = 'Safety Officer' and is_demo = true
);

-- SCRUM-128's approval writes Preparation; the original database constraint omitted it.
alter table public.events drop constraint if exists events_status_check;
alter table public.events add constraint events_status_check check (
    status in ('Draft', 'Submitted', 'Assigned', 'Under review', 'Approved',
               'Planning', 'Confirmed', 'Preparation', 'Completed', 'Rejected', 'Cancelled')
);

-- The Flask backend remains the only database client for identities and events.
-- This migration changes no grants or RLS policies.
notify pgrst, 'reload schema';
commit;
