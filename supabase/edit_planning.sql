-- SCRUM-23 (US-4.6 Edit event info during Planning): audit trail of edits made while an
-- event is in Planning. One row per edit — records who edited, which fields changed, and
-- whether it was an important (confirmed-arrangement-affecting) or ordinary change.
-- Run seed_users.sql + create_events.sql first. Safe to rerun (IF NOT EXISTS).
begin;

create table if not exists public.event_edit_log (
    id bigint generated always as identity primary key,
    event_id uuid not null references public.events(id),
    -- The coordinator who made the edit (nullable so an edit is still logged if identity
    -- resolution somehow fails; normally always set).
    editor_id integer references public.app_users(id),
    -- The event fields that changed in this edit.
    changed_fields text[] not null,
    -- 'important' if any confirmed-arrangement-affecting field changed, else 'ordinary'.
    importance text not null,
    occurred_at timestamptz not null default now()
);

create index if not exists event_edit_log_event_idx
    on public.event_edit_log (event_id, occurred_at desc);

-- Backend-only, same posture as the other audit tables.
alter table public.event_edit_log enable row level security;
revoke all on public.event_edit_log from anon, authenticated;
grant select, insert on public.event_edit_log to service_role;

commit;

-- Verify:
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'event_edit_log'
order by ordinal_position;
