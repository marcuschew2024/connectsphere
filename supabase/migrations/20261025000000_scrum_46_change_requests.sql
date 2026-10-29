-- SCRUM-46: organiser change requests for submitted/confirmed events.
begin;

create table if not exists public.event_change_requests (
    id bigint generated always as identity primary key,
    event_id uuid not null references public.events(id) on delete cascade,
    requested_by integer not null references public.app_users(id),
    description text not null check (char_length(btrim(description)) between 1 and 2000),
    status text not null default 'Pending' check (
        status in ('Pending', 'Under Review', 'Approved', 'Rejected', 'Implemented')
    ),
    reviewed_by integer references public.app_users(id),
    review_note text check (review_note is null or char_length(review_note) <= 2000),
    requested_at timestamptz not null default now(),
    reviewed_at timestamptz
);

create index if not exists event_change_requests_event_idx
    on public.event_change_requests (event_id, requested_at desc);
create index if not exists event_change_requests_reviewer_idx
    on public.event_change_requests (reviewed_by, status);

alter table public.event_change_requests enable row level security;
revoke all on public.event_change_requests from anon, authenticated;
grant select, insert, update on public.event_change_requests to service_role;

notify pgrst, 'reload schema';

commit;
