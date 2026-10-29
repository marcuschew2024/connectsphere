-- SCRUM-139: dedicated password-login accounts for all seven roles, plus a second
-- Organiser, Coordinator and Attendee for cross-account isolation checks.
-- DEVELOPMENT / TEST DATA ONLY. Never run this against a production database.
-- Run after seed_users.sql, login_auth.sql and the SCRUM-127 / SCRUM-131 role migrations.
-- Safe to rerun: an existing account keeps its ID; its name, role and password are reset
-- and any lockout is cleared.
--
-- No password is stored in this file. Choose one (12+ characters) and set it for this
-- session first. In the Supabase SQL Editor, add this line above the file and run both:
--   select set_config('connectsphere.seed_password', '<your password>', false);
-- With psql: PGOPTIONS='-c connectsphere.seed_password=<your password>' psql -f ...
begin;

-- Supabase already provides pgcrypto in the extensions schema; a bare Postgres needs it.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
    if length(coalesce(current_setting('connectsphere.seed_password', true), '')) < 12 then
        raise exception 'Set connectsphere.seed_password (12+ characters) before running this seed.';
    end if;
end $$;

lock table public.app_users in share row exclusive mode;

-- Explicit IDs may already have been inserted without advancing the identity sequence
-- (same guard as the SCRUM-127 / SCRUM-131 migrations).
select setval(
    pg_get_serial_sequence('public.app_users', 'id'),
    greatest((select coalesce(max(id), 1) from public.app_users),
             coalesce(pg_sequence_last_value(pg_get_serial_sequence('public.app_users', 'id')::regclass), 1)),
    true
);

-- is_demo = false: these accounts never appear in the development role switcher, and the
-- API's bcrypt check accepts pgcrypto's $2a$ hashes.
insert into public.app_users
    (display_name, role, is_demo, email, password_hash, failed_attempts, locked_until)
select account.display_name, account.role, false, account.email,
       extensions.crypt(current_setting('connectsphere.seed_password'), extensions.gen_salt('bf', 12)),
       0, null
from (values
    ('Organiser Account A', 'Organiser', 'organiser.a@connectsphere.test'),
    ('Organiser Account B', 'Organiser', 'organiser.b@connectsphere.test'),
    ('Coordinator Account A', 'Coordinator', 'coordinator.a@connectsphere.test'),
    ('Coordinator Account B', 'Coordinator', 'coordinator.b@connectsphere.test'),
    ('Event Coordinator Lead Account', 'Event Coordinator Lead', 'coordinator-lead@connectsphere.test'),
    ('Venue Staff Account', 'Venue Staff', 'venue-staff@connectsphere.test'),
    ('Tech Support Account', 'Tech Support', 'tech-support@connectsphere.test'),
    ('Safety Officer Account', 'Safety Officer', 'safety-officer@connectsphere.test'),
    ('Attendee Account A', 'Attendee', 'attendee.a@connectsphere.test'),
    ('Attendee Account B', 'Attendee', 'attendee.b@connectsphere.test')
) as account(display_name, role, email)
on conflict (email) do update set
    display_name = excluded.display_name,
    role = excluded.role,
    is_demo = false,
    password_hash = excluded.password_hash,
    failed_attempts = 0,
    locked_until = null;

commit;

-- You should see the same ten accounts after every run.
select id, display_name, role, email
from public.app_users
where email like '%@connectsphere.test'
order by role, email;
