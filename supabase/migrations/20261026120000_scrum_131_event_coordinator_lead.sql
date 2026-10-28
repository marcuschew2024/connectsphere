-- SCRUM-131 (Week 7 Change #5): add the Event Coordinator Lead role.
-- Run after seed_users.sql and create_events.sql. Safe to rerun.
-- Mirrors SCRUM-127 (Safety Officer): the role is added by ALTERing the CHECK
-- constraint on top of the original five-role baseline, never by editing seed_users.sql.
-- Never assumes a particular user ID is free.
begin;
lock table public.app_users in access exclusive mode;

alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (
    role in ('Organiser', 'Coordinator', 'Venue Staff', 'Tech Support', 'Attendee',
             'Safety Officer', 'Event Coordinator Lead')
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
select 'Demo Event Coordinator Lead', 'Event Coordinator Lead', true
where not exists (
    select 1 from public.app_users where role = 'Event Coordinator Lead' and is_demo = true
);

-- The Flask backend remains the only database client for identities and events.
-- This migration changes no grants or RLS policies.
notify pgrst, 'reload schema';
commit;
