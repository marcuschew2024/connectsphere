-- Disposable acceptance database only; never apply to a shared Supabase project.
-- No application grants are broadened to let tests create user accounts.
insert into public.app_users (id, display_name, role, is_demo)
select actor, 'Roster attendee ' || actor, 'Attendee', false
from generate_series(45001, 45027) actor;
