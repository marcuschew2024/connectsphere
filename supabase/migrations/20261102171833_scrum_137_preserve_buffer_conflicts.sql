-- SCRUM-137 / R1: current occupied windows, preserved legacy conflicts, serialized writes.
-- Prerequisites: SCRUM-129 buffers, SCRUM-137 occupied columns, SCRUM-79 hold release.
-- Review D64 before deployment. No booking is deleted, cancelled, or rescheduled here.
begin;

-- Stop writes during the atomic change of enforcement; readers may continue.
lock table public.venues, public.venue_bookings in share row exclusive mode;

-- A real row UPDATE serializes each venue's writers, including REPEATABLE READ:
-- stale snapshots fail with 40001 rather than admitting a missed overlap.
create table if not exists public.venue_buffer_write_guards (
    venue_id uuid primary key references public.venues(id) on delete cascade,
    version bigint not null default 0
);
alter table public.venue_buffer_write_guards enable row level security;
revoke all on public.venue_buffer_write_guards from public, anon, authenticated, service_role;
insert into public.venue_buffer_write_guards (venue_id)
select id from public.venues on conflict do nothing;

create or replace function public.lock_venue_buffer_writes(p_venue_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
    insert into public.venue_buffer_write_guards as guard (venue_id, version)
    values (p_venue_id, 1)
    on conflict (venue_id) do update set version = guard.version + 1;
end;
$$;

create or replace function public.lock_booking_buffer_writes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare room uuid;
begin
    -- Deterministic ordering for a move between venues. Locks last until commit.
    for room in select distinct id from unnest(case
        when tg_op = 'INSERT' then array[new.venue_id]
        when tg_op = 'DELETE' then array[old.venue_id]
        else array[old.venue_id, new.venue_id] end) as rooms(id) order by id
    loop
        perform public.lock_venue_buffer_writes(room);
    end loop;
    if tg_op = 'DELETE' then return old; end if;
    return new;
end;
$$;
drop trigger if exists a_venue_bookings_lock_buffers on public.venue_bookings;
create trigger a_venue_bookings_lock_buffers before insert or update or delete
on public.venue_bookings for each row execute function public.lock_booking_buffer_writes();

-- A permanent buffer-induced overlap cannot satisfy a blanket occupied exclusion.
-- Keep the original raw-time exclusions as defence in depth; the serialized trigger
-- below enforces the CURRENT occupied interval on every new/changed booking.
alter table public.venue_bookings drop constraint if exists venue_bookings_no_overlap_hard;
alter table public.venue_bookings drop constraint if exists venue_bookings_one_tentative_hold;
alter table public.venue_bookings add constraint venue_bookings_no_overlap_hard
    exclude using gist (venue_id with =, tstzrange(start_at, end_at, '[)') with &&)
    where (status in ('Confirmed', 'Blocked'));
alter table public.venue_bookings add constraint venue_bookings_one_tentative_hold
    exclude using gist (venue_id with =, tstzrange(start_at, end_at, '[)') with &&)
    where (status in ('Requested', 'Pending', 'Held'));

create or replace function public.set_venue_booking_buffer_interval()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    check_slot boolean;
    same_tier text[];
begin
    select coalesce(setup_time_minutes, 0), coalesce(turnaround_time_minutes, 0)
      into new.setup_minutes, new.turnaround_minutes
      from public.venues where id = new.venue_id;
    new.occupied_start := new.start_at - make_interval(mins => new.setup_minutes);
    new.occupied_end := new.end_at + make_interval(mins => new.turnaround_minutes);

    if tg_op = 'INSERT' then
        check_slot := true;
    else
        check_slot := (new.venue_id, new.start_at, new.end_at, new.status, new.expires_at)
            is distinct from (old.venue_id, old.start_at, old.end_at, old.status, old.expires_at);
    end if;
    -- A buffer-only refresh or harmless metadata edit preserves an existing conflict.
    -- There is no caller-controlled bypass flag, and supplied occupied fields are ignored.
    if not check_slot then return new; end if;
    if new.status in ('Confirmed', 'Blocked') then
        same_tier := array['Confirmed', 'Blocked'];
    elsif new.status in ('Requested', 'Pending', 'Held') then
        if new.expires_at is not null and new.expires_at <= now() then return new; end if;
        same_tier := array['Requested', 'Pending', 'Held'];
    else
        return new;
    end if;
    -- Preserve FCFS: confirmed wins over tentative, but two hard slots or two live
    -- tentative slots must never gain a new overlap. API request policy remains stricter.
    if exists (
        select 1 from public.venue_bookings b
        where b.venue_id = new.venue_id and b.id is distinct from new.id
          and b.status = any(same_tier)
          and not (b.status in ('Requested', 'Pending', 'Held')
                   and b.expires_at is not null and b.expires_at <= now())
          and b.occupied_start < new.occupied_end
          and new.occupied_start < b.occupied_end
    ) then
        raise exclusion_violation using message = 'Venue booking overlaps an occupied setup/turnaround window';
    end if;
    return new;
end;
$$;
drop trigger if exists venue_bookings_set_buffer_interval on public.venue_bookings;
create trigger venue_bookings_set_buffer_interval before insert or update
on public.venue_bookings for each row execute function public.set_venue_booking_buffer_interval();

-- The table is a current conflict snapshot, not an audit/event log. FK cascades remove
-- only report rows when a booking is legitimately deleted (e.g. test fixture cleanup).
alter table public.problematic_venue_bookings
    drop constraint if exists problematic_venue_bookings_booking_id_fkey,
    drop constraint if exists problematic_venue_bookings_conflicting_booking_id_fkey;
alter table public.problematic_venue_bookings
    add constraint problematic_venue_bookings_booking_id_fkey
        foreign key (booking_id) references public.venue_bookings(id) on delete cascade,
    add constraint problematic_venue_bookings_conflicting_booking_id_fkey
        foreign key (conflicting_booking_id) references public.venue_bookings(id) on delete cascade;

create or replace function public.refresh_venue_buffer_conflicts(p_venue_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
    delete from public.problematic_venue_bookings where venue_id = p_venue_id;
    insert into public.problematic_venue_bookings (venue_id, booking_id, conflicting_booking_id)
    select a.venue_id, a.id, b.id
    from public.venue_bookings a join public.venue_bookings b
      on b.venue_id = a.venue_id and a.id < b.id
    where a.venue_id = p_venue_id
      and a.status in ('Confirmed', 'Blocked', 'Requested', 'Pending', 'Held')
      and b.status in ('Confirmed', 'Blocked', 'Requested', 'Pending', 'Held')
      and not (a.status in ('Requested', 'Pending', 'Held')
               and a.expires_at is not null and a.expires_at <= now())
      and not (b.status in ('Requested', 'Pending', 'Held')
               and b.expires_at is not null and b.expires_at <= now())
      and a.occupied_start < b.occupied_end and b.occupied_start < a.occupied_end
      -- Match SCRUM-129's report: exclude raw overlaps permitted by cross-tier FCFS.
      and not (a.start_at < b.end_at and b.start_at < a.end_at);
end;
$$;

create or replace function public.refresh_venue_booking_buffers()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    perform public.lock_venue_buffer_writes(new.id);
    update public.venue_bookings
       set setup_minutes = new.setup_time_minutes, turnaround_minutes = new.turnaround_time_minutes
     where venue_id = new.id;
    perform public.refresh_venue_buffer_conflicts(new.id);
    return new;
end;
$$;

create or replace function public.refresh_booking_buffer_conflicts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if tg_op = 'UPDATE' then
        if (new.venue_id, new.start_at, new.end_at, new.status, new.expires_at)
            is not distinct from (old.venue_id, old.start_at, old.end_at, old.status, old.expires_at)
        then return null; end if;
    end if;
    if tg_op <> 'INSERT' then perform public.refresh_venue_buffer_conflicts(old.venue_id); end if;
    if tg_op <> 'DELETE' then perform public.refresh_venue_buffer_conflicts(new.venue_id); end if;
    return null;
end;
$$;
drop trigger if exists venue_bookings_refresh_conflict_report on public.venue_bookings;
create trigger venue_bookings_refresh_conflict_report after insert or update or delete
on public.venue_bookings for each row execute function public.refresh_booking_buffer_conflicts();

-- These are internal trigger helpers, never Data API RPC endpoints. Definer rights are
-- required for the private guard/report tables; application privileges are unchanged.
revoke all on function public.lock_venue_buffer_writes(uuid) from public, anon, authenticated, service_role;
revoke all on function public.lock_booking_buffer_writes() from public, anon, authenticated, service_role;
revoke all on function public.set_venue_booking_buffer_interval() from public, anon, authenticated, service_role;
revoke all on function public.refresh_venue_buffer_conflicts(uuid) from public, anon, authenticated, service_role;
revoke all on function public.refresh_venue_booking_buffers() from public, anon, authenticated, service_role;
revoke all on function public.refresh_booking_buffer_conflicts() from public, anon, authenticated, service_role;

-- Repair stale occupied values/report rows atomically. Keep all published booking fields.
update public.venues set setup_time_minutes = setup_time_minutes;
notify pgrst, 'reload schema';
commit;
