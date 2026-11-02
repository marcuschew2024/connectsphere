-- SCRUM-169 / R5: operational blocks cover setup, event and turnaround.
-- Existing events/bookings survive a new block; only new/changed active bookings
-- are refused. Block creation is still followed by affected-booking notification.
begin;

create or replace function public.serialize_venue_block_writes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    -- Booking writes already hold ROW EXCLUSIVE until commit. Taking a conflicting
    -- lock before a block statement gives either ordering a complete result:
    -- booking first => block reports it; block first => booking guard refuses it.
    -- This short, table-wide lock is deliberately limited to rare block changes.
    lock table public.venue_bookings in share row exclusive mode;
    return null;
end;
$$;
revoke all on function public.serialize_venue_block_writes() from public, anon, authenticated;

drop trigger if exists serialize_venue_block_writes on public.venue_unavailability;
create trigger serialize_venue_block_writes
before insert or update or delete on public.venue_unavailability
for each statement execute function public.serialize_venue_block_writes();

create or replace function public.reject_booking_in_active_venue_block()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    proposed_start timestamptz;
    proposed_end timestamptz;
begin
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
revoke all on function public.reject_booking_in_active_venue_block() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
