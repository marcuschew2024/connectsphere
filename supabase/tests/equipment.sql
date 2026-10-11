-- Stock and audit must commit together; browser roles cannot forge either.
begin;
do $$
declare
    role_name text;
begin
    foreach role_name in array array['anon', 'authenticated'] loop
        if has_function_privilege(role_name, 'public.save_equipment_item(jsonb,integer,uuid,integer)', 'execute')
            or has_table_privilege(role_name, 'public.equipment_items', 'select') then
            raise exception 'Browser role can access equipment directly';
        end if;
    end loop;
    if not has_function_privilege('service_role', 'public.save_equipment_item(jsonb,integer,uuid,integer)', 'execute')
        or has_table_privilege('service_role', 'public.equipment_items', 'insert,update,delete')
        or has_table_privilege('service_role', 'public.equipment_item_history', 'insert,update,delete') then
        raise exception 'Unexpected equipment backend permissions';
    end if;
end;
$$;

-- Seed before installing the failing audit trigger, so update rollback can be checked.
create temporary table original_equipment as
select * from public.save_equipment_item(
    '{"equipment_type":"Audit test","description":"Test stock","total_quantity":4,"location":"Test store","operational_status":"Operational"}', 4
);
create function public.reject_test_equipment_audit() returns trigger
language plpgsql as $$ begin raise exception 'simulated audit failure'; end; $$;
create trigger reject_test_equipment_audit before insert on public.equipment_item_history
    for each row execute function public.reject_test_equipment_audit();
do $$
declare
    original public.equipment_items;
    details jsonb := '{"equipment_type":"Audit test","description":"Test stock","total_quantity":4,"location":"Test store","operational_status":"Damaged"}';
begin
    select * into original from original_equipment;
    begin
        perform public.save_equipment_item(details, 4, original.id, 1);
        raise exception 'Expected audit failure';
    exception when raise_exception then
        if sqlerrm <> 'simulated audit failure' then raise; end if;
    end;
    if (select to_jsonb(e) from public.equipment_items e where id = original.id) <> to_jsonb(original)
        or (select count(*) from public.equipment_item_history where equipment_id = original.id) <> 1 then
        raise exception 'Audit failure did not roll back update';
    end if;
    begin
        perform public.save_equipment_item(details, 4);
        raise exception 'Expected audit failure';
    exception when raise_exception then
        if sqlerrm <> 'simulated audit failure' then raise; end if;
    end;
    if (select count(*) from public.equipment_items where equipment_type = 'Audit test') <> 1 then
        raise exception 'Audit failure did not roll back creation';
    end if;
end;
$$;
rollback;
