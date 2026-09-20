-- SCRUM-20: run seed_users.sql and create_events.sql first, then this file.
-- Adds real login credentials, account lockout, and an auth audit log to app_users.
-- Safe to rerun: uses IF NOT EXISTS and ADD COLUMN IF NOT EXISTS throughout.
begin;

-- Add login credentials and lockout fields to the existing app_users table.
alter table public.app_users
    add column if not exists email text unique,
    add column if not exists password_hash text,
    add column if not exists failed_attempts integer not null default 0,
    add column if not exists locked_until timestamptz;

-- Audit log: one row per login or logout event.
create table if not exists public.auth_audit_log (
    id bigint generated always as identity primary key,
    user_id integer references public.app_users(id),
    -- 'login_success', 'login_failure', 'logout', 'account_locked'
    event_type text not null,
    -- Store only the username attempted, never the submitted password.
    attempted_email text,
    ip_address text,
    occurred_at timestamptz not null default now()
);

create index if not exists auth_audit_log_user_idx
    on public.auth_audit_log (user_id, occurred_at desc);
create index if not exists auth_audit_log_occurred_idx
    on public.auth_audit_log (occurred_at desc);

-- Flask reads and writes both tables using the backend service_role key.
-- Browsers (anon / authenticated roles) must never access credentials directly.
alter table public.auth_audit_log enable row level security;
revoke all on public.auth_audit_log from anon, authenticated;
grant select, insert on public.auth_audit_log to service_role;

-- Allow Flask to update the lockout fields and password hash on app_users.
grant update (password_hash, failed_attempts, locked_until) on public.app_users to service_role;

commit;

-- Verify: should show the new columns on app_users.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'app_users'
  and column_name in ('email', 'password_hash', 'failed_attempts', 'locked_until')
order by column_name;
