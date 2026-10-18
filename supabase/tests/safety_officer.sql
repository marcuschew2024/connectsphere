-- Assert the rerunnable upgrade preserves occupied IDs, permissions and identities.
do $$
begin
  if (select count(*) from public.app_users where role = 'Safety Officer' and is_demo) <> 1 then
    raise exception 'Expected exactly one demo Safety Officer after repeated migration';
  end if;
  if (select role from public.app_users where id = 6) <> 'Organiser'
     or (select role from public.app_users where id = 7) <> 'Coordinator' then
    raise exception 'The migration changed pre-existing users';
  end if;
  if exists (select 1 from public.app_users where role = 'Safety Officer' and id <= 7) then
    raise exception 'The migration reused an occupied ID';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.app_users'::regclass)
     or has_table_privilege('anon', 'public.app_users', 'SELECT')
     or has_table_privilege('authenticated', 'public.app_users', 'UPDATE') then
    raise exception 'Identity protection regressed';
  end if;
end $$;
