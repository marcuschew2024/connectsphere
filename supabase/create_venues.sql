-- SCRUM-24: shared venue catalogue. Run after seed_users.sql. Safe to rerun.
begin;

create or replace function public.valid_venue_features(features text[])
returns boolean language sql immutable set search_path = '' as $$
    select features is not null
        and cardinality(features) <= 20
        and not exists (
            select 1 from unnest(features) as feature
            where feature is null or char_length(btrim(feature)) not between 1 and 80
        );
$$;

-- Weekly, same-day opening intervals in Asia/Singapore; JSON null means Closed.
create or replace function public.valid_venue_hours(hours jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
    slot jsonb;
    open_days integer := 0;
begin
    if hours is null or jsonb_typeof(hours) is distinct from 'object' then
        return false;
    end if;
    if not (hours ?& array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])
        or (select count(*) from jsonb_object_keys(hours)) <> 7 then
        return false;
    end if;
    for slot in select value from jsonb_each(hours) loop
        if slot = 'null'::jsonb then continue; end if;
        if jsonb_typeof(slot) is distinct from 'object' then return false; end if;
        if (select count(*) from jsonb_object_keys(slot)) <> 2
            or jsonb_typeof(slot->'opens') is distinct from 'string'
            or jsonb_typeof(slot->'closes') is distinct from 'string' then
            return false;
        end if;
        if (slot->>'opens') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            or (slot->>'closes') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            or (slot->>'opens') >= (slot->>'closes') then
            return false;
        end if;
        open_days := open_days + 1;
    end loop;
    return open_days > 0;
end;
$$;

create table if not exists public.venues (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(btrim(name)) between 1 and 200),
    location text not null check (char_length(btrim(location)) between 1 and 300),
    capacity integer not null check (capacity > 0),
    facilities text[] not null check (public.valid_venue_features(facilities)),
    accessibility text[] not null check (public.valid_venue_features(accessibility)),
    supported_layouts text[] not null check (
        public.valid_venue_features(supported_layouts) and cardinality(supported_layouts) > 0
    ),
    operating_hours jsonb not null check (public.valid_venue_hours(operating_hours)),
    timezone text not null default 'Asia/Singapore' check (timezone = 'Asia/Singapore'),
    created_by integer not null references public.app_users(id),
    created_at timestamptz not null default now()
);

-- Enforce duplicates in the database too, including simultaneous submissions.
create unique index if not exists venues_name_location_unique on public.venues (
    lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')),
    lower(regexp_replace(btrim(location), '[[:space:]]+', ' ', 'g'))
);
create index if not exists venues_created_idx on public.venues (created_at desc, id);

-- Flask enforces Venue Staff writes and Venue Staff/Coordinator reads.
alter table public.venues enable row level security;
revoke all on public.venues from anon, authenticated;
grant select, insert on public.venues to service_role;
notify pgrst, 'reload schema';
commit;
