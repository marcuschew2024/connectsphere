-- Only the backend RPC may create immutable requests and their audit attribution.
begin;
do $$
declare role_name text;
begin
    foreach role_name in array array['anon', 'authenticated'] loop
        if has_function_privilege(role_name, 'public.record_equipment_request(uuid,jsonb,integer)', 'execute')
            or has_table_privilege(role_name, 'public.equipment_requests', 'select,insert,update,delete')
            or has_table_privilege(role_name, 'public.equipment_request_items', 'select,insert,update,delete') then
            raise exception 'Browser role can bypass equipment request API';
        end if;
    end loop;
    if not has_function_privilege('service_role', 'public.record_equipment_request(uuid,jsonb,integer)', 'execute')
        or has_table_privilege('service_role', 'public.equipment_requests', 'insert,update,delete')
        or has_table_privilege('service_role', 'public.equipment_request_items', 'insert,update,delete') then
        raise exception 'Unexpected request backend permissions';
    end if;
end;
$$;
rollback;
