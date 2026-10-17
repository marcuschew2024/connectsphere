-- SCRUM-35. Run after create_events.sql and create_equipment.sql.
-- Requests record demand; they do not reserve or subtract catalogue stock.
begin;
create table if not exists public.equipment_requests (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null references public.events(id),
    status text not null default 'Requested' check (status = 'Requested'),
    routed_to text not null default 'Tech Support' check (routed_to = 'Tech Support'),
    requested_by integer not null references public.app_users(id),
    requested_at timestamptz not null default now()
);
create index if not exists equipment_requests_order
    on public.equipment_requests (requested_at desc, id);
create index if not exists equipment_requests_event on public.equipment_requests (event_id);

create table if not exists public.equipment_request_items (
    request_id uuid not null references public.equipment_requests(id) on delete cascade,
    position integer not null check (position between 1 and 50),
    equipment_id uuid not null references public.equipment_items(id),
    quantity integer not null check (quantity > 0),
    technical_notes text not null check (length(technical_notes) <= 2000),
    -- Preserve what was requested even if Tech Support later renames the catalogue entry.
    equipment_type text not null,
    location text not null,
    primary key (request_id, equipment_id),
    unique (request_id, position)
);
alter table public.equipment_requests enable row level security;
alter table public.equipment_request_items enable row level security;
revoke all on public.equipment_requests, public.equipment_request_items
    from anon, authenticated, service_role;
grant select on public.equipment_requests, public.equipment_request_items to service_role;

create or replace function public.record_equipment_request(
    p_event_id uuid, p_items jsonb, p_actor_id integer
) returns setof public.equipment_requests
language plpgsql security definer set search_path = '' as $$
declare
    chosen_event public.events;
    saved public.equipment_requests;
    stock public.equipment_items;
    item jsonb;
    item_position integer := 0;
    quantity numeric;
begin
    if not exists (select 1 from public.app_users where id = p_actor_id and role = 'Coordinator') then
        raise sqlstate 'PT403' using message = 'Coordinator required';
    end if;
    -- Keep assignment/status stable until the whole request has committed.
    select * into chosen_event from public.events where id = p_event_id for share;
    if not found then raise sqlstate 'PT404' using message = 'Event not found'; end if;
    if chosen_event.coordinator_id is distinct from p_actor_id then
        raise sqlstate 'PT403' using message = 'Assigned Coordinator required';
    end if;
    if chosen_event.status <> 'Planning' then
        raise sqlstate 'PT409' using message = 'Event must be in Planning';
    end if;
    if jsonb_typeof(p_items) is distinct from 'array' then
        raise sqlstate '22023' using message = 'Items must be an array';
    end if;
    if jsonb_array_length(p_items) not between 1 and 50 then
        raise sqlstate '22023' using message = 'Include 1 to 50 items';
    end if;
    insert into public.equipment_requests(event_id, requested_by)
    values (p_event_id, p_actor_id) returning * into saved;
    for item in select value from jsonb_array_elements(p_items) loop
        if jsonb_typeof(item) is distinct from 'object' then
            raise sqlstate '22023' using message = 'Invalid item';
        end if;
        if not (item ?& array['equipment_id','quantity','technical_notes'])
            or (select count(*) from jsonb_object_keys(item)) <> 3
            or jsonb_typeof(item->'equipment_id') is distinct from 'string'
            or jsonb_typeof(item->'quantity') is distinct from 'number'
            or jsonb_typeof(item->'technical_notes') is distinct from 'string' then
            raise sqlstate '22023' using message = 'Invalid item fields';
        end if;
        quantity := (item->>'quantity')::numeric;
        if quantity <> trunc(quantity) or quantity < 1 or quantity > 2147483647 then
            raise sqlstate '22023' using message = 'Quantity must be a positive integer';
        end if;
        select * into stock from public.equipment_items
        where id = (item->>'equipment_id')::uuid for share;
        if not found then raise sqlstate 'PT404' using message = 'Equipment not found'; end if;
        item_position := item_position + 1;
        insert into public.equipment_request_items (
            request_id, position, equipment_id, quantity, technical_notes, equipment_type, location
        ) values (
            saved.id, item_position, stock.id, quantity::integer,
            btrim(item->>'technical_notes'), stock.equipment_type, stock.location
        );
    end loop;
    return next saved;
end;
$$;
revoke all on function public.record_equipment_request(uuid, jsonb, integer)
    from public, anon, authenticated;
grant execute on function public.record_equipment_request(uuid, jsonb, integer) to service_role;
notify pgrst, 'reload schema';
commit;
