-- SCRUM-155: a notification can name the specific record it is about (the venue booking
-- or equipment request), so its link opens that record's review page instead of a queue.
-- Nullable: older notifications, and types about the event itself, have no subject.
-- No foreign key: the subject may be a booking or an equipment request. Safe to rerun.
begin;

alter table public.notifications add column if not exists subject_id uuid;

notify pgrst, 'reload schema';

commit;
