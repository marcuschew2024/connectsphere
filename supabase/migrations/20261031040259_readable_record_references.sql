-- User-requested display references. UUID primary/foreign keys remain unchanged.
-- Apply after the existing event, venue, equipment and registration schemas.
begin;

create or replace function public.keep_record_reference()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
    if new.reference_number is distinct from old.reference_number then
        raise exception 'Record references cannot be changed' using errcode = '22023';
    end if;
    return new;
end;
$$;
revoke all on function public.keep_record_reference() from public, anon, authenticated;

do $$
declare
    record_type record;
begin
    for record_type in select * from (values
        ('events', 'EVT'), ('venue_bookings', 'BKG'),
        ('equipment_requests', 'EQR'), ('event_registrations', 'REG'),
        ('venues', 'VNU'), ('equipment_items', 'EQP')
    ) as types(table_name, prefix) loop
        -- Identity backfills existing rows once and allocates safely across writers.
        execute format('alter table public.%I add column if not exists reference_number bigint generated always as identity', record_type.table_name);
        execute format(
            'alter table public.%I add column if not exists reference text generated always as (%L || lpad(reference_number::text, greatest(3, length(reference_number::text)), ''0'')) stored',
            record_type.table_name, record_type.prefix || '-'
        );
        execute format('create unique index if not exists %I on public.%I(reference)', record_type.table_name || '_reference_key', record_type.table_name);
        execute format('drop trigger if exists keep_record_reference on public.%I', record_type.table_name);
        execute format('create trigger keep_record_reference before update of reference_number on public.%I for each row execute function public.keep_record_reference()', record_type.table_name);
        execute format('grant usage, select on sequence %s to service_role', pg_get_serial_sequence('public.' || record_type.table_name, 'reference_number'));
        execute format('revoke all on sequence %s from public, anon, authenticated', pg_get_serial_sequence('public.' || record_type.table_name, 'reference_number'));
    end loop;
end;
$$;

-- Preserve the same registration reference after withdrawal.
create or replace function public.withdraw_event_attendee(p_event_id uuid, p_attendee_id integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare registration public.event_registrations;
begin
    perform 1 from public.app_users where id = p_attendee_id and role = 'Attendee';
    if not found then raise sqlstate 'PT403' using message = 'Attendee required'; end if;
    -- Registration first, then the parent via its trigger: consistent with direct
    -- UPDATE locking. Repeated/concurrent withdrawal returns the original receipt.
    select * into registration from public.event_registrations
    where event_id = p_event_id and attendee_id = p_attendee_id for update;
    if not found then raise sqlstate 'PT404' using message = 'Registration not found'; end if;
    if registration.status <> 'Withdrawn' then
        update public.event_registrations set status = 'Withdrawn'
        where id = registration.id returning * into registration;
    end if;
    return jsonb_build_object('id', registration.id, 'reference', registration.reference, 'event_id', registration.event_id,
        'status', registration.status, 'registered_at', registration.registered_at,
        'withdrawn_at', registration.withdrawn_at);
end;
$$;

notify pgrst, 'reload schema';
commit;
