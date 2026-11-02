-- SCRUM-79: an expired tentative hold releases its venue slot (Week 7 Customer Change #4).
--
-- The application engine already ignores a hold past its deadline, but the exclusion
-- constraints did not: a 'Held' row kept blocking its slot forever, so search showed the
-- slot free and the insert was then refused. This makes the database agree with the engine.
--
-- Why a trigger and not a constraint predicate: an index/constraint predicate must be
-- IMMUTABLE, and now() is STABLE, so "ignore rows whose expires_at has passed" cannot be
-- expressed in the EXCLUDE predicate itself. Instead, stale holds are moved out of the
-- tentative tier ('Expired' appears in no exclusion predicate) before any booking write.
--
-- Rows are kept, never deleted: an expired hold is part of the venue's history (S1 Q23).

begin;

-- Make the sweep cheap. The predicate is immutable (a status literal), so it is allowed.
create index if not exists venue_bookings_expiring_holds_idx
    on public.venue_bookings (venue_id, expires_at)
    where status = 'Held';

create or replace function public.release_expired_venue_holds()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    -- A confirmed slot must never carry a hold deadline: once the booking is decided the
    -- deadline is spent, and leaving it set is what let a confirmed booking be treated as
    -- expired. Clearing it here makes that unrepresentable regardless of the caller.
    if new.status = 'Confirmed' then
        new.expires_at := null;
    end if;

    -- Only a write that takes or keeps a slot needs the venue's stale holds cleared. The
    -- recursive invocation from the UPDATE below arrives with status 'Expired' and stops
    -- here, so this can only nest one level deep.
    if new.status in ('Requested', 'Pending', 'Held', 'Confirmed') then
        update public.venue_bookings
           set status = 'Expired',
               updated_at = now()
         where venue_id = new.venue_id
           and status = 'Held'
           and expires_at is not null
           and expires_at <= now()
           and id is distinct from new.id;
    end if;
    return new;
end;
$$;

-- Runs before venue_bookings_set_buffer_interval (SCRUM-137) by name order; the two touch
-- different columns, so the order is immaterial beyond being deterministic.
drop trigger if exists venue_bookings_release_expired_holds on public.venue_bookings;
create trigger venue_bookings_release_expired_holds
before insert or update of venue_id, start_at, end_at, status, expires_at
on public.venue_bookings
for each row execute function public.release_expired_venue_holds();

-- Bring existing data in line with the rule this migration introduces. Both statements are
-- idempotent and safe to replay.
update public.venue_bookings
   set status = 'Expired',
       updated_at = now()
 where status = 'Held'
   and expires_at is not null
   and expires_at <= now();

update public.venue_bookings
   set expires_at = null
 where status = 'Confirmed'
   and expires_at is not null;

notify pgrst, 'reload schema';
commit;
