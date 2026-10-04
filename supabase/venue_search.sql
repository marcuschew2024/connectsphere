-- SCRUM-28: additive retirement marker for catalogue searches.
-- Run after create_venues.sql. Existing venues remain active; no rows are removed.
begin;
alter table public.venues add column if not exists is_retired boolean not null default false;
notify pgrst, 'reload schema';
commit;
