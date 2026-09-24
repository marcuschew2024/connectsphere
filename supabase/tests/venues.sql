-- SCRUM-24 database boundaries and direct-browser access; never retain test rows.
begin;
do $$
declare
    schedule jsonb := '{"monday":{"opens":"09:00","closes":"18:00"},"tuesday":null,"wednesday":null,"thursday":null,"friday":null,"saturday":null,"sunday":null}';
begin
    if not public.valid_venue_hours(schedule) then raise exception 'Valid hours rejected'; end if;
    if public.valid_venue_hours(jsonb_set(schedule, '{monday,closes}', '"09:00"'))
        or public.valid_venue_hours(jsonb_set(schedule, '{monday,closes}', '"08:00"'))
        or public.valid_venue_hours(jsonb_set(schedule, '{monday,opens}', '"24:00"'))
        or public.valid_venue_hours(jsonb_set(schedule, '{monday}', 'null'))
        or public.valid_venue_hours(schedule - 'sunday') then
        raise exception 'Invalid hours accepted';
    end if;
    if has_table_privilege('anon', 'public.venues', 'SELECT')
        or has_table_privilege('anon', 'public.venues', 'INSERT')
        or has_table_privilege('authenticated', 'public.venues', 'SELECT')
        or has_table_privilege('authenticated', 'public.venues', 'INSERT') then
        raise exception 'Venue data exposed directly to browser roles';
    end if;
end;
$$;
rollback;
