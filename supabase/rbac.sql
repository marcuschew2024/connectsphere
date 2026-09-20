-- SCRUM-21 (US-1.2 Role-based access): records every denied access attempt.
-- Run seed_users.sql, create_events.sql (and ideally login_auth.sql) first.
-- Separate from auth_audit_log on purpose: that table is for AUTHENTICATION events
-- (login/logout); this one is for AUTHORISATION denials, and needs event/action context.
-- Safe to rerun: IF NOT EXISTS throughout.
begin;

create table if not exists public.access_denied_log (
    id bigint generated always as identity primary key,
    -- Who attempted the action (the acting user). Nullable so a denial is still logged
    -- even if identity resolution is the thing that failed.
    actor_id integer references public.app_users(id),
    -- The actor's role at the time, captured for the audit trail (roles could change).
    actor_role text,
    -- What they tried to do, e.g. 'create_event', 'view_event', 'change_status'.
    action text not null,
    -- The event involved, when the denial is event-specific. Nullable otherwise.
    event_id uuid references public.events(id),
    -- Why it was denied, e.g. 'role not permitted', 'not a related user'.
    reason text,
    ip_address text,
    occurred_at timestamptz not null default now()
);

create index if not exists access_denied_log_actor_idx
    on public.access_denied_log (actor_id, occurred_at desc);
create index if not exists access_denied_log_occurred_idx
    on public.access_denied_log (occurred_at desc);

-- Backend-only, same posture as auth_audit_log: the browser roles must never touch it.
alter table public.access_denied_log enable row level security;
revoke all on public.access_denied_log from anon, authenticated;
grant select, insert on public.access_denied_log to service_role;

commit;

-- Verify: should list the new table's columns.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'access_denied_log'
order by ordinal_position;
