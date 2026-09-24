-- ONLY for a new disposable PostgreSQL database, never the shared Supabase project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to service_role;
-- Supabase normally provides sequence access for its backend service role.
alter default privileges in schema public grant usage, select on sequences to service_role;
