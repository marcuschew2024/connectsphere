-- SCRUM-36/SCRUM-37: equipment reservations table and constraints
-- Run after create_equipment.sql and create_events.sql.
begin;

create extension if not exists btree_gist;

create table if not exists public.equipment_reservations (
    id uuid primary key default gen_random_uuid(),
    event_id uuid references public.events(id) on delete set null,
    equipment_id uuid not null references public.equipment_items(id) on delete cascade,
    quantity integer not null check (quantity > 0),
    start_at timestamptz not null,
    end_at timestamptz not null,
    status text not null default 'Reserved' check (
        status in ('Reserved', 'Pending', 'Released', 'Cancelled')
    ),
    created_by integer not null references public.app_users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint equipment_reservations_time_order check (end_at > start_at)
);

create index if not exists equipment_reservations_equipment_idx
    on public.equipment_reservations (equipment_id, start_at, end_at);

create index if not exists equipment_reservations_event_idx
    on public.equipment_reservations (event_id, created_at desc);

create index if not exists equipment_reservations_status_idx
    on public.equipment_reservations (status);

alter table public.equipment_reservations enable row level security;
revoke all on public.equipment_reservations from anon, authenticated;
grant select, insert, update on public.equipment_reservations to service_role;

commit;
