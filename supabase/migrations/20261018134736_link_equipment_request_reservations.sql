-- SCRUM-38 follow-up: a request status reflects real, time-bound stock reservations.
-- Apply after SCRUM-36/37 and 20261018111728. Existing bookings are never guessed/backfilled.
begin;
alter table public.equipment_reservations add column if not exists request_id uuid
    references public.equipment_requests(id) on delete set null;
create unique index if not exists equipment_reservations_request_item
    on public.equipment_reservations(request_id, equipment_id);
alter table public.equipment_requests
    add column if not exists reservation_start_at timestamptz,
    add column if not exists reservation_end_at timestamptz;
alter table public.equipment_request_history
    add column if not exists reservation_snapshot jsonb;

-- Both the catalogue and request flow write the same table. Serialize capacity
-- checks on the stock row so simultaneous saves cannot take the same last unit.
create or replace function public.check_equipment_reservation_capacity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare usable integer; reserved bigint; event_status text;
begin
    if new.status not in ('Reserved', 'Pending') then return new; end if;
    -- Linking an existing booking or changing only metadata consumes no extra stock.
    if tg_op = 'UPDATE' then
        if old.status in ('Reserved', 'Pending')
            and (new.equipment_id, new.event_id, new.start_at, new.end_at)
                is not distinct from (old.equipment_id, old.event_id, old.start_at, old.end_at)
            and new.quantity <= old.quantity then return new; end if;
    end if;
    if new.event_id is not null then
        select status into event_status from public.events where id = new.event_id for share;
        if event_status in ('Cancelled', 'Completed', 'Rejected') then
            raise sqlstate 'PT409' using message = 'closed_event';
        end if;
    end if;
    select usable_quantity into usable from public.equipment_items
        where id = new.equipment_id for update;
    select coalesce(sum(quantity), 0) into reserved from public.equipment_reservations
        where equipment_id = new.equipment_id and id <> new.id
        and status in ('Reserved', 'Pending')
        and start_at < new.end_at and end_at > new.start_at;
    if new.quantity + reserved > usable then
        raise sqlstate 'PT409' using message = 'insufficient_equipment';
    end if;
    return new;
end;
$$;
revoke all on function public.check_equipment_reservation_capacity() from public, anon, authenticated;
drop trigger if exists equipment_reservation_capacity on public.equipment_reservations;
create trigger equipment_reservation_capacity before insert or update on public.equipment_reservations
    for each row execute function public.check_equipment_reservation_capacity();

create or replace function public.save_equipment_request_reservations(
    p_request_id uuid, p_start_at timestamptz, p_end_at timestamptz,
    p_items jsonb, p_notes text, p_revision integer, p_actor_id integer
) returns setof public.equipment_requests
language plpgsql security definer set search_path = '' as $$
declare
    actor public.app_users; previous public.equipment_requests; saved public.equipment_requests;
    event_id uuid; event_status text; item jsonb; requested public.equipment_request_items;
    booking public.equipment_reservations; amount integer;
    item_count integer; full_count integer := 0; total_reserved bigint := 0;
    next_status text; snapshot jsonb;
begin
    select * into actor from public.app_users where id = p_actor_id and role = 'Tech Support' for share;
    if not found then raise sqlstate 'PT403' using message = 'Tech Support required'; end if;
    if p_start_at is null or p_end_at is null or not isfinite(p_start_at) or not isfinite(p_end_at)
        or p_end_at <= p_start_at or p_notes is null or length(btrim(p_notes)) > 2000
        or p_revision is null or p_revision < 1
        or p_items is null or jsonb_typeof(p_items) <> 'array' then
        raise sqlstate '22023' using message = 'Invalid reservation details';
    end if;
    select r.event_id into event_id from public.equipment_requests r where id = p_request_id;
    if not found then raise sqlstate 'PT404' using message = 'Request not found'; end if;
    select status into event_status from public.events where id = event_id for share;
    if event_status in ('Cancelled', 'Completed', 'Rejected') then
        raise sqlstate 'PT409' using message = 'closed_event';
    end if;
    select * into previous from public.equipment_requests where id = p_request_id for update;
    if not found then raise sqlstate 'PT404' using message = 'Request not found'; end if;
    if previous.revision <> p_revision then raise sqlstate 'PT409' using message = 'stale_request'; end if;
    select count(*) into item_count from public.equipment_request_items where request_id = p_request_id;
    if jsonb_array_length(p_items) <> item_count or
        (select count(distinct (value->>'equipment_id')::uuid) from jsonb_array_elements(p_items)) <> item_count then
        raise sqlstate '22023' using message = 'Include each requested item once';
    end if;
    -- Stable ordering across requests avoids deadlocks when they share several items.
    perform e.id from public.equipment_items e
        join public.equipment_request_items i on i.equipment_id = e.id
        where i.request_id = p_request_id order by e.id for update of e;
    for item in select value from jsonb_array_elements(p_items) loop
        if jsonb_typeof(item) <> 'object'
            or not (item ?& array['equipment_id', 'quantity'])
            or (item - array['equipment_id', 'quantity', 'reservation_id']) <> '{}'::jsonb
            or jsonb_typeof(item->'quantity') <> 'number'
            or (item->>'quantity') !~ '^(0|[1-9][0-9]*)$' then
            raise sqlstate '22023' using message = 'Invalid reservation item';
        end if;
        select * into requested from public.equipment_request_items
            where request_id = p_request_id and equipment_id = (item->>'equipment_id')::uuid;
        if not found then raise sqlstate '22023' using message = 'Item not requested'; end if;
        amount := (item->>'quantity')::integer;
        if amount > requested.quantity then raise sqlstate '22023' using message = 'Exceeds requested quantity'; end if;
        if item ? 'reservation_id' then
            -- An explicit choice links an old catalogue booking without adding another unit.
            select * into booking from public.equipment_reservations
                where id = (item->>'reservation_id')::uuid for update;
            if not found or booking.request_id is not null or booking.status not in ('Reserved', 'Pending')
                or booking.event_id is distinct from event_id or booking.equipment_id <> requested.equipment_id
                or booking.quantity <> amount or booking.start_at <> p_start_at or booking.end_at <> p_end_at
                or exists (select 1 from public.equipment_reservations
                    where request_id = p_request_id and equipment_id = requested.equipment_id) then
                raise sqlstate 'PT409' using message = 'booking_changed';
            end if;
            update public.equipment_reservations set request_id = p_request_id, updated_at = clock_timestamp()
                where id = booking.id;
        elsif amount = 0 then
            update public.equipment_reservations set status = 'Released', updated_at = clock_timestamp()
                where request_id = p_request_id and equipment_id = requested.equipment_id
                and status in ('Reserved', 'Pending');
        else
            -- Update an existing row first: INSERT ... ON CONFLICT would run the
            -- capacity trigger before finding the conflict and count this booking twice.
            update public.equipment_reservations set quantity = amount, start_at = p_start_at,
                end_at = p_end_at, status = 'Reserved', updated_at = clock_timestamp()
                where request_id = p_request_id and equipment_id = requested.equipment_id;
            if not found then
                insert into public.equipment_reservations
                    (request_id, event_id, equipment_id, quantity, start_at, end_at, created_by)
                    values (p_request_id, event_id, requested.equipment_id, amount, p_start_at, p_end_at, actor.id);
            end if;
        end if;
        total_reserved := total_reserved + amount;
        if amount = requested.quantity then full_count := full_count + 1; end if;
    end loop;
    next_status := case when full_count = item_count then 'Reserved'
        when total_reserved > 0 then 'Partially fulfilled' else 'Requested' end;
    select jsonb_build_object('start_at', p_start_at, 'end_at', p_end_at, 'items',
        jsonb_agg(jsonb_build_object('equipment_type', i.equipment_type,
            'quantity', (v.value->>'quantity')::integer) order by i.position)) into snapshot
        from jsonb_array_elements(p_items) v
        join public.equipment_request_items i on i.request_id = p_request_id
            and i.equipment_id = (v.value->>'equipment_id')::uuid;
    update public.equipment_requests set status = next_status, update_notes = btrim(p_notes),
        revision = previous.revision + 1, updated_by = actor.id, updated_at = clock_timestamp(),
        reservation_start_at = p_start_at, reservation_end_at = p_end_at
        where id = p_request_id returning * into saved;
    insert into public.equipment_request_history
        (request_id, revision, from_status, status, notes, actor_id, actor_name, changed_at, reservation_snapshot)
        values (saved.id, saved.revision, previous.status, saved.status, saved.update_notes,
            actor.id, actor.display_name, saved.updated_at, snapshot);
    return next saved;
end;
$$;
revoke all on function public.save_equipment_request_reservations(uuid,timestamptz,timestamptz,jsonb,text,integer,integer)
    from public, anon, authenticated;
grant execute on function public.save_equipment_request_reservations(uuid,timestamptz,timestamptz,jsonb,text,integer,integer)
    to service_role;

-- Manual status is only for requests with no linked stock. Reserved/partial
-- must come from the transaction above, never from selecting a label.
create or replace function public.update_equipment_request_status(
    p_request_id uuid, p_status text, p_notes text, p_revision integer, p_actor_id integer
) returns setof public.equipment_requests
language plpgsql security definer set search_path = '' as $$
declare
    actor public.app_users; event_id uuid; event_status text;
    previous public.equipment_requests; saved public.equipment_requests;
begin
    select * into actor from public.app_users where id = p_actor_id and role = 'Tech Support' for share;
    if not found then raise sqlstate 'PT403' using message = 'Tech Support required'; end if;
    if p_status is null or p_status not in ('Requested', 'Unavailable')
        or p_notes is null or length(btrim(p_notes)) > 2000
        or p_revision is null or p_revision < 1 then
        raise sqlstate '22023' using message = 'Invalid status update';
    end if;
    select r.event_id into event_id from public.equipment_requests r where id = p_request_id;
    if not found then raise sqlstate 'PT404' using message = 'Request not found'; end if;
    select status into event_status from public.events where id = event_id for share;
    if event_status in ('Cancelled', 'Completed', 'Rejected') then
        raise sqlstate 'PT409' using message = 'closed_event';
    end if;
    select * into previous from public.equipment_requests where id = p_request_id for update;
    if not found then raise sqlstate 'PT404' using message = 'Request not found'; end if;
    if p_revision <> previous.revision then raise sqlstate 'PT409' using message = 'stale_request'; end if;
    if exists (select 1 from public.equipment_reservations where request_id = p_request_id
        and status in ('Reserved', 'Pending')) then
        raise sqlstate 'PT409' using message = 'linked_reservations';
    end if;
    if p_status = previous.status then raise sqlstate 'PT409' using message = 'unchanged_status'; end if;
    update public.equipment_requests set status = p_status, update_notes = btrim(p_notes),
        revision = previous.revision + 1, updated_by = actor.id, updated_at = clock_timestamp()
        where id = p_request_id returning * into saved;
    insert into public.equipment_request_history
        (request_id, revision, from_status, status, notes, actor_id, actor_name, changed_at)
        values (saved.id, saved.revision, previous.status, saved.status, saved.update_notes,
            actor.id, actor.display_name, saved.updated_at);
    return next saved;
end;
$$;
revoke all on function public.update_equipment_request_status(uuid,text,text,integer,integer)
    from public, anon, authenticated;
grant execute on function public.update_equipment_request_status(uuid,text,text,integer,integer) to service_role;
notify pgrst, 'reload schema';
commit;
