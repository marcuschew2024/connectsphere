-- SCRUM-169 / R5: operational blocks cover setup, event and turnaround.
-- Existing events/bookings survive a new block; only new/changed active bookings
-- are refused. Block creation is still followed by affected-booking notification.
begin;

do $$
begin
    if to_regprocedure('public.lock_venue_buffer_writes(uuid)') is null then
        raise exception 'SCRUM-169 requires the R1 preserve_buffer_conflicts migration first';
    end if;
end;
$$;

-- R1 D65 is a prerequisite. Use the same versioned per-venue guard as booking
-- and buffer writes, so READ COMMITTED waits/rechecks and stale snapshots abort.
-- This also serializes two competing maintenance blocks at the same venue.
create or replace function public.serialize_venue_block_writes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare room uuid;
begin
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
revoke all on function public.serialize_venue_block_writes()
    from public, anon, authenticated, service_role;

drop trigger if exists serialize_venue_block_writes on public.venue_unavailability;
drop trigger if exists a_venue_blocks_lock_buffers on public.venue_unavailability;
create trigger a_venue_blocks_lock_buffers
before insert or update or delete on public.venue_unavailability
for each row execute function public.serialize_venue_block_writes();

create or replace function public.reject_booking_in_active_venue_block()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    proposed_start timestamptz;
    proposed_end timestamptz;
begin
    -- New operational blocks may affect existing bookings without cancelling them.
    -- A metadata edit or R1 buffer refresh must not become an implicit rebooking.
    if tg_op = 'UPDATE' then
        if (new.venue_id, new.start_at, new.end_at, new.status, new.expires_at)
            is not distinct from (old.venue_id, old.start_at, old.end_at, old.status, old.expires_at)
        then return new; end if;
    end if;
    if new.status in ('Requested', 'Pending', 'Held')
       and new.expires_at is not null and new.expires_at <= now()
    then return new; end if;
    if new.status in ('Requested', 'Pending', 'Held', 'Confirmed') then
        -- This trigger runs alphabetically before the R1 occupancy trigger. Derive
        -- from NEW times and the authoritative venue instead of reading stale or
        -- caller-supplied NEW.occupied_* fields. Maintenance has no extra buffers.
        select new.start_at - make_interval(mins => v.setup_time_minutes),
               new.end_at + make_interval(mins => v.turnaround_time_minutes)
          into proposed_start, proposed_end
          from public.venues v where v.id = new.venue_id;
        if exists (
            select 1 from public.venue_unavailability block
             where block.venue_id = new.venue_id and block.status = 'Active'
               and block.start_at < proposed_end and block.end_at > proposed_start
        ) then
            raise exception 'The venue is unavailable during the event or its setup/turnaround time'
                using errcode = '23P01';
        end if;
    end if;
    return new;
end;
$$;
revoke all on function public.reject_booking_in_active_venue_block() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
