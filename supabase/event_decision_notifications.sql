-- SCRUM-18: coordinator approve/reject decisions.
begin;

alter table public.events
    add column if not exists decision_reason text
        check (char_length(decision_reason) <= 2000),
    add column if not exists decision_by integer references public.app_users(id),
    add column if not exists decision_at timestamptz;

create table if not exists public.notifications (
    id bigint generated always as identity primary key,
    recipient_id integer not null references public.app_users(id),
    event_id uuid not null references public.events(id) on delete cascade,
    notification_type text not null,
    message text not null,
    read_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_idx
    on public.notifications (recipient_id, created_at desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select, insert, update on public.notifications to service_role;

commit;