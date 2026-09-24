-- SCRUM-22: return submitted requests to organisers for clarification.
-- Run after create_events.sql and event_decision_notifications.sql. Safe to rerun.
begin;

alter table public.event_status_history
    add column if not exists action text,
    add column if not exists note text check (char_length(note) <= 2000);

create table if not exists public.event_clarifications (
    id bigint generated always as identity primary key,
    event_id uuid not null references public.events(id) on delete cascade,
    note text not null check (char_length(note) between 1 and 2000),
    requested_by integer not null references public.app_users(id),
    requested_at timestamptz not null default now(),
    status text not null default 'Pending' check (status in ('Pending', 'Resubmitted')),
    responded_by integer references public.app_users(id),
    responded_at timestamptz
);

create unique index if not exists event_clarifications_pending_idx
    on public.event_clarifications (event_id)
    where status = 'Pending';

create index if not exists event_clarifications_event_idx
    on public.event_clarifications (event_id, requested_at desc);

alter table public.event_clarifications enable row level security;
revoke all on public.event_clarifications from anon, authenticated;
grant select, insert, update on public.event_clarifications to service_role;

commit;