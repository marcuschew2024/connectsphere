-- SCRUM-49 / R07 (see Decision Log: notifications hybrid recipient model).
-- A notification targets either a specific user (recipient_id) or an unassigned
-- role pool (recipient_role: Venue Staff / Tech Support). The reader returns rows
-- where recipient_id = current user OR recipient_role = current user's role, so
-- every role sees its notifications -- not just Organisers (the R07 bug).
begin;

alter table public.notifications
    add column if not exists recipient_role text;

-- recipient_role is only ever a shared-queue role; specific users use recipient_id.
-- (No per-event assignment of Venue Staff / Tech Support exists in Release 1 --
-- Customer Clarification S1 Q10/Q16, S2 Q9/Q13 -- so they are notified as a pool.)
alter table public.notifications
    drop constraint if exists notifications_recipient_role_allowed;
alter table public.notifications
    add constraint notifications_recipient_role_allowed
        check (recipient_role is null or recipient_role in ('Venue Staff', 'Tech Support'));

-- Exactly one target: a specific user OR a role pool, never both, never neither.
alter table public.notifications
    alter column recipient_id drop not null;
alter table public.notifications
    drop constraint if exists notifications_recipient_target;
alter table public.notifications
    add constraint notifications_recipient_target
        check ((recipient_id is not null) <> (recipient_role is not null));

create index if not exists notifications_recipient_role_idx
    on public.notifications (recipient_role, created_at desc);

commit;
