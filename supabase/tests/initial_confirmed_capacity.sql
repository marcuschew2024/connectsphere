-- Disposable database: the replaced RPC must retain its backend-only privileges.
do $$
declare rpc oid := 'public.set_registration_capacity(uuid,integer,integer)'::regprocedure;
begin
    if has_function_privilege('anon', rpc, 'execute')
        or has_function_privilege('authenticated', rpc, 'execute') then
        raise exception 'Browser roles must not set capacity';
    end if;
    if not has_function_privilege('service_role', rpc, 'execute') then
        raise exception 'Backend must retain capacity RPC access';
    end if;
    if (select prosecdef from pg_proc where oid = rpc) then
        raise exception 'Capacity RPC must remain SECURITY INVOKER';
    end if;
    if not exists (select 1 from pg_proc where oid = rpc
                   and proconfig @> array['search_path=""']) then
        raise exception 'Capacity RPC must retain an empty search path';
    end if;
end;
$$;
