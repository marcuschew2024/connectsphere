-- SCRUM-60: venue unavailability periods.
begin;

create table if not exists public.venue_unavailability (
    id uuid primary key default gen_random_uuid(),
    venue_id uuid not null references public.venues(id),
    start_at timestamptz not null,
    end_at timestamptz not null,
    reason text not null check (reason in (
        'Maintenance', 'Renovation', 'Safety', 'Failure', 'Emergency', 'Internal activity'
    )),
    note text check (char_length(note) <= 2000),
    status text not null default 'Active' check (status in ('Active', 'Unblocked')),
    created_by integer not null references public.app_users(id),
    created_at timestamptz not null default now(),
    unblocked_by integer references public.app_users(id),
    unblocked_at timestamptz,
    constraint venue_unavailability_time_order check (end_at > start_at),
    constraint venue_unavailability_unblocked_audit check (
        (status = 'Active' and unblocked_by is null and unblocked_at is null)
        or (status = 'Unblocked' and unblocked_by is not null and unblocked_at is not null)
    )
);

create index if not exists venue_unavailability_active_idx
    on public.venue_unavailability (venue_id, start_at, end_at)
    where status = 'Active';

create or replace function public.reject_overlapping_venue_block()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.status = 'Active'
       and exists (
           select 1
           from public.venue_unavailability existing
           where existing.venue_id = new.venue_id
             and existing.status = 'Active'
             and existing.id is distinct from new.id
             and existing.start_at < new.end_at
             and existing.end_at > new.start_at
       ) then
        raise exception 'The venue is already blocked during this time period'
            using errcode = '23P01';
    end if;
    return new;
end;
$$;

drop trigger if exists reject_overlapping_venue_block on public.venue_unavailability;
create trigger reject_overlapping_venue_block
before insert or update on public.venue_unavailability
for each row execute function public.reject_overlapping_venue_block();

create or replace function public.reject_booking_in_active_venue_block()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.status in ('Requested', 'Pending', 'Held', 'Confirmed')
       and exists (
           select 1
           from public.venue_unavailability block
           where block.venue_id = new.venue_id
             and block.status = 'Active'
             and block.start_at < new.end_at
             and block.end_at > new.start_at
       ) then
        raise exception 'The venue is unavailable for this time slot'
            using errcode = '23P01';
    end if;
    return new;
end;
$$;

drop trigger if exists reject_booking_in_active_venue_block on public.venue_bookings;
create trigger reject_booking_in_active_venue_block
before insert or update on public.venue_bookings
for each row execute function public.reject_booking_in_active_venue_block();

alter table public.venue_unavailability enable row level security;
revoke all on public.venue_unavailability from anon, authenticated;
grant select, insert, update on public.venue_unavailability to service_role;

notify pgrst, 'reload schema';
commit;
