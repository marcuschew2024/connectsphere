-- SCRUM-26: Venue Staff retire a venue (Decision Log D35).
-- Run after venue_search.sql (SCRUM-28 adds venues.is_retired), update_venues.sql
-- (SCRUM-25 adds venues.revision) and create_venue_bookings.sql. Safe to rerun.
--
-- A retired venue keeps its row and every booking; it only stops accepting new ones.
begin;

-- Who retired the venue and when. retired_by has no foreign key on purpose: a second
-- venues -> app_users link would make the catalogue's existing creator embed ambiguous
-- in PostgREST. retire_venue() is the only writer and checks the actor first.
alter table public.venues add column if not exists retired_at timestamptz;
alter table public.venues add column if not exists retired_by integer;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'venues_retirement_audit') then
        alter table public.venues add constraint venues_retirement_audit check (
            (retired_at is null) = (retired_by is null)
            and (retired_at is null or is_retired)
        );
    end if;
end;
$$;

-- Retire one venue in one transaction. Refuses while booking requests are still
-- waiting for a decision, so nothing is rejected on staff's behalf; Confirmed
-- bookings are never changed.
create or replace function public.retire_venue(p_venue_id uuid, p_actor_id integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
    saved public.venues;
    outstanding integer;
    kept integer;
begin
    if not exists (
        select 1 from public.app_users where id = p_actor_id and role = 'Venue Staff'
    ) then
        raise sqlstate 'PT403' using message = 'Venue Staff required';
    end if;

    select * into saved from public.venues where id = p_venue_id for update;
    if not found then
        raise sqlstate 'PT404' using message = 'Venue not found';
    end if;
    if saved.is_retired then
        raise sqlstate 'PT409' using message = 'already_retired';
    end if;

    -- Counted after the row lock, so a request inserted concurrently is either
    -- seen here or refused by the trigger below.
    select count(*) into outstanding from public.venue_bookings
    where venue_id = p_venue_id and status in ('Requested', 'Pending', 'Held');
    if outstanding > 0 then
        raise sqlstate 'PT409' using message = 'outstanding_requests',
            detail = outstanding::text;
    end if;

    -- revision moves on so an edit form opened before retirement cannot save.
    update public.venues
    set is_retired = true, retired_at = now(), retired_by = p_actor_id,
        revision = revision + 1
    where id = p_venue_id
    returning * into saved;

    select count(*) into kept from public.venue_bookings
    where venue_id = p_venue_id and status = 'Confirmed' and end_at > now();

    return jsonb_build_object('venue', to_jsonb(saved), 'kept_confirmed_bookings', kept);
end;
$$;

revoke all on function public.retire_venue(uuid, integer) from public, anon, authenticated;
grant execute on function public.retire_venue(uuid, integer) to service_role;

-- No new or moved booking may take a retired venue. Existing rows can still change
-- status (for example a Confirmed booking being cancelled). FOR SHARE waits for an
-- in-flight retirement, so the two cannot both succeed.
create or replace function public.reject_booking_on_retired_venue()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
    retired boolean;
begin
    if new.status in ('Requested', 'Pending', 'Held', 'Confirmed')
        and (tg_op = 'INSERT'
             or new.venue_id is distinct from old.venue_id
             or new.status is distinct from old.status) then
        select is_retired into retired from public.venues where id = new.venue_id for share;
        if retired then
            raise exception 'Venue retired' using errcode = '23P01';
        end if;
    end if;
    return new;
end;
$$;

revoke all on function public.reject_booking_on_retired_venue() from public, anon, authenticated;

drop trigger if exists reject_booking_on_retired_venue on public.venue_bookings;
create trigger reject_booking_on_retired_venue
before insert or update on public.venue_bookings
for each row execute function public.reject_booking_on_retired_venue();

notify pgrst, 'reload schema';
commit;
