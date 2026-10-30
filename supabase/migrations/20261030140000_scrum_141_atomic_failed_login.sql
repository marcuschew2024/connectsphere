-- SCRUM-141 (R12): record a failed login atomically. A single UPDATE increments the
-- counter and locks the account when it reaches the threshold, so two concurrent failed
-- attempts cannot lose an increment — the former read-then-write in auth.py could, which
-- let the lockout undercount. Thresholds are passed in so the Flask app stays the single
-- source of truth (MAX_FAILED_ATTEMPTS / LOCKOUT_MINUTES). Safe to rerun.
begin;

create or replace function public.register_failed_login(
    p_user_id integer, p_max_attempts integer, p_lockout_minutes integer
) returns jsonb
language sql security definer set search_path = '' as $$
    update public.app_users
    set failed_attempts = failed_attempts + 1,
        locked_until = case
            when failed_attempts + 1 >= p_max_attempts
            then now() + make_interval(mins => p_lockout_minutes)
            else locked_until
        end
    where id = p_user_id
    returning jsonb_build_object(
        'failed_attempts', failed_attempts,
        'locked_until', locked_until
    );
$$;

revoke all on function public.register_failed_login(integer, integer, integer)
    from public, anon, authenticated;
grant execute on function public.register_failed_login(integer, integer, integer)
    to service_role;

notify pgrst, 'reload schema';

commit;
