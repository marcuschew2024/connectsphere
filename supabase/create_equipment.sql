-- SCRUM-34: each row is a stock batch with one location and condition.
-- Run after seed_users.sql. All writes go through the audited backend-only RPC.
begin;

create table if not exists public.equipment_items (
    id uuid primary key default gen_random_uuid(),
    equipment_type text not null check (length(btrim(equipment_type)) between 1 and 100),
    description text not null check (length(btrim(description)) between 1 and 2000),
    total_quantity integer not null check (total_quantity >= 0),
    location text not null check (length(btrim(location)) between 1 and 300),
    operational_status text not null check (
        operational_status in ('Operational', 'Damaged', 'Under Maintenance')
    ),
    -- This is usable stock, before date/time reservations (SCRUM-36/37).
    usable_quantity integer generated always as (
        case when operational_status = 'Operational' then total_quantity else 0 end
    ) stored,
    created_by integer not null references public.app_users(id),
    created_at timestamptz not null default now(),
    updated_by integer not null references public.app_users(id),
    updated_at timestamptz not null default now(),
    revision integer not null default 1 check (revision > 0)
);
create index if not exists equipment_catalogue_order
    on public.equipment_items (created_at desc, id);

create table if not exists public.equipment_item_history (
    id uuid primary key default gen_random_uuid(),
    equipment_id uuid not null references public.equipment_items(id) on delete cascade,
    action text not null check (action in ('Created', 'Updated')),
    actor_id integer not null references public.app_users(id),
    changed_at timestamptz not null,
    before_details jsonb,
    after_details jsonb not null
);
create index if not exists equipment_history_order
    on public.equipment_item_history (equipment_id, changed_at);

alter table public.equipment_items enable row level security;
alter table public.equipment_item_history enable row level security;
revoke all on public.equipment_items, public.equipment_item_history
    from anon, authenticated, service_role;
grant select on public.equipment_items, public.equipment_item_history to service_role;

create or replace function public.save_equipment_item(
    p_details jsonb,
    p_actor_id integer,
    p_equipment_id uuid default null,
    p_revision integer default null
) returns setof public.equipment_items
language plpgsql security definer set search_path = '' as $$
declare
    previous public.equipment_items;
    saved public.equipment_items;
    field_name text;
    quantity numeric;
begin
    if not exists (
        select 1 from public.app_users where id = p_actor_id and role = 'Tech Support'
    ) then
        raise sqlstate 'PT403' using message = 'Only Tech Support can maintain equipment';
    end if;
    if jsonb_typeof(p_details) is distinct from 'object' then
        raise sqlstate '22023' using message = 'Invalid equipment details';
    end if;
    if not (p_details ?& array[
        'equipment_type', 'description', 'total_quantity', 'location', 'operational_status'
    ]) or (select count(*) from jsonb_object_keys(p_details)) <> 5 then
        raise sqlstate '22023' using message = 'Send the five equipment fields only';
    end if;
    foreach field_name in array array['equipment_type','description','location','operational_status'] loop
        if jsonb_typeof(p_details->field_name) is distinct from 'string' then
            raise sqlstate '22023' using message = 'Equipment text fields must be strings';
        end if;
    end loop;
    if jsonb_typeof(p_details->'total_quantity') is distinct from 'number' then
        raise sqlstate '22023' using message = 'Quantity must be a non-negative integer';
    end if;
    quantity := (p_details->>'total_quantity')::numeric;
    if quantity <> trunc(quantity) or quantity < 0 or quantity > 2147483647 then
        raise sqlstate '22023' using message = 'Quantity must be a non-negative integer';
    end if;

    if p_equipment_id is null then
        if p_revision is not null then
            raise sqlstate '22023' using message = 'New equipment cannot supply a revision';
        end if;
        insert into public.equipment_items (
            equipment_type, description, total_quantity, location, operational_status,
            created_by, updated_by
        ) values (
            btrim(p_details->>'equipment_type'), btrim(p_details->>'description'), quantity::integer,
            btrim(p_details->>'location'), p_details->>'operational_status', p_actor_id, p_actor_id
        ) returning * into saved;
    else
        select * into previous from public.equipment_items where id = p_equipment_id for update;
        if not found then
            raise sqlstate 'PT404' using message = 'Equipment not found';
        end if;
        if p_revision is distinct from previous.revision then
            raise sqlstate 'PT409' using message = 'Equipment changed since it was loaded';
        end if;
        update public.equipment_items set
            equipment_type = btrim(p_details->>'equipment_type'),
            description = btrim(p_details->>'description'),
            total_quantity = quantity::integer,
            location = btrim(p_details->>'location'),
            operational_status = p_details->>'operational_status',
            updated_by = p_actor_id, updated_at = clock_timestamp(), revision = revision + 1
        where id = p_equipment_id returning * into saved;
    end if;
    insert into public.equipment_item_history (
        equipment_id, action, actor_id, changed_at, before_details, after_details
    ) values (
        saved.id, case when p_equipment_id is null then 'Created' else 'Updated' end,
        p_actor_id, saved.updated_at,
        case when p_equipment_id is null then null else to_jsonb(previous) end, to_jsonb(saved)
    );
    return next saved;
end;
$$;
revoke all on function public.save_equipment_item(jsonb, integer, uuid, integer)
    from public, anon, authenticated;
grant execute on function public.save_equipment_item(jsonb, integer, uuid, integer) to service_role;
notify pgrst, 'reload schema';
commit;
