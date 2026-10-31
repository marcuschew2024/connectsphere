-- Database-owned identifiers: replay/backfill, immutability and >999 safety.
begin;
do $$
declare
    kind record;
    bad_rows bigint;
    target public.events;
    stable text;
    total bigint;
begin
    for kind in select * from (values
        ('events', 'EVT'), ('venue_bookings', 'BKG'),
        ('equipment_requests', 'EQR'), ('event_registrations', 'REG'),
        ('venues', 'VNU'), ('equipment_items', 'EQP')
    ) as kinds(table_name, prefix) loop
        execute format('select count(*) from public.%I where reference is null or reference !~ %L', kind.table_name, '^' || kind.prefix || '-[0-9]{3,}$') into bad_rows;
        assert bad_rows = 0, 'Existing records must receive references';
        assert not has_sequence_privilege('anon', pg_get_serial_sequence('public.' || kind.table_name, 'reference_number'), 'usage');
        assert not has_sequence_privilege('authenticated', pg_get_serial_sequence('public.' || kind.table_name, 'reference_number'), 'usage');
    end loop;
    insert into public.events(title, organiser_id, status) values ('Reference stability', 1, 'Draft') returning * into target;
    stable := target.reference;
    update public.events set title = 'Renamed', event_datetime = '2099-11-01T08:00:00Z' where id = target.id;
    assert (select reference = stable from public.events where id = target.id), 'Editing must not renumber a record';
    begin
        update public.events set reference_number = reference_number + 10000 where id = target.id;
        raise exception 'Reference changed';
    exception when generated_always then null;
    end;
    begin
        update public.events set reference_number = default where id = target.id;
        raise exception 'Reference reset';
    exception when invalid_parameter_value then null;
    end;
    begin
        insert into public.events(title, organiser_id, reference_number) values ('Injected reference', 1, 99999);
        raise exception 'Caller supplied a reference';
    exception when generated_always then null;
    end;
    insert into public.events(title, organiser_id, status)
    select 'Reference bulk ' || n, 1, 'Draft' from generate_series(1, 1005) n;
    select count(distinct reference) into total from public.events where title like 'Reference bulk %';
    assert total = 1005, 'References must remain distinct after 999';
    assert exists (select 1 from public.events where reference_number > 999 and reference = 'EVT-' || reference_number::text);
end;
$$;
rollback;
