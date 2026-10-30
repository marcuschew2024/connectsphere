#!/bin/sh
# Run inside the disposable compose database container: sh /sql/tests/run.sh
set -eu
export PGUSER=postgres PGDATABASE=connectsphere
psql -v ON_ERROR_STOP=1 -f /sql/tests/bootstrap.sql
for pass in 1 2; do
  for migration in seed_users create_events login_auth rbac edit_planning event_decision_notifications auto_assign_coordinator request_clarification create_venues create_venue_bookings venue_search update_venues create_equipment create_equipment_requests create_equipment_reservations; do
    psql -v ON_ERROR_STOP=1 -f "/sql/$migration.sql" > /tmp/migration-output.txt
  done
  psql -v ON_ERROR_STOP=1 -f /sql/migrations/20261025000000_scrum_46_change_requests.sql > /tmp/migration-output.txt
  psql -v ON_ERROR_STOP=1 -f /sql/migrations/20261018111728_scrum_38_equipment_request_status.sql > /tmp/migration-output.txt
  echo "Migration pass $pass: PASS"
done
for check in drafts assignment venues venue_updates venue_overlap equipment equipment_requests equipment_request_status; do
  psql -v ON_ERROR_STOP=1 -f "/sql/tests/$check.sql"
  echo "$check database checks: PASS"
done
psql -v ON_ERROR_STOP=1 <<'SQL'
insert into public.app_users (id, display_name, role, is_demo) values
  (6, 'Organiser B', 'Organiser', true),
  (7, 'Coordinator B', 'Coordinator', true);
-- Test-fixture cleanup only; this grant is absent from the application migration.
grant delete on public.venues to service_role;
grant delete on public.venue_bookings to service_role;
grant delete on public.equipment_items to service_role;
grant delete on public.equipment_requests to service_role;
grant delete on public.events to service_role;
grant delete on public.equipment_reservations to service_role;
notify pgrst, 'reload schema';
SQL
for pass in 1 2; do
  psql -v ON_ERROR_STOP=1 -f /sql/migrations/20261017074746_scrum_127_safety_officer.sql > /tmp/migration-output.txt
  echo "Safety Officer migration pass $pass: PASS"
done
psql -v ON_ERROR_STOP=1 -f /sql/tests/safety_officer.sql

# SCRUM-131 (Week 7 Change #5): add the Event Coordinator Lead role. Applied twice to
# prove the drop/recreate constraint + not-exists seed are rerun-safe.
for pass in 1 2; do
  psql -v ON_ERROR_STOP=1 -f /sql/migrations/20261026120000_scrum_131_event_coordinator_lead.sql > /tmp/migration-output.txt
  echo "Event Coordinator Lead migration pass $pass: PASS"
done

# SCRUM-139: password accounts for all seven roles. The password is a disposable-database
# value only; api/tests/test_role_accounts_acceptance.py logs in with the same one.
for pass in 1 2; do
  PGOPTIONS='-c connectsphere.seed_password=disposable-test-only-password' \
    psql -v ON_ERROR_STOP=1 -f /sql/seed_role_accounts.sql > /tmp/migration-output.txt
  echo "Role accounts seed pass $pass: PASS"
done


# Check the original status migration above, then the reservation integration twice.
for pass in 1 2; do
  psql -v ON_ERROR_STOP=1 -f /sql/migrations/20261018134736_link_equipment_request_reservations.sql > /tmp/migration-output.txt
  echo "Request reservations migration pass $pass: PASS"
done
psql -v ON_ERROR_STOP=1 -f /sql/tests/equipment_request_reservations.sql

for pass in 1 2; do
  psql -v ON_ERROR_STOP=1 -f /sql/migrations/20261023193600_scrum_129_venue_buffers.sql > /tmp/migration-output.txt
  echo "Venue buffers migration pass $pass: PASS"
done
psql -v ON_ERROR_STOP=1 -f /sql/tests/venue_buffers.sql

for pass in 1 2; do
  psql -v ON_ERROR_STOP=1 -f /sql/migrations/20261029170000_scrum_79_tentative_venue_holds.sql > /tmp/migration-output.txt
  echo "Tentative venue holds migration pass $pass: PASS"
done
psql -v ON_ERROR_STOP=1 -f /sql/tests/venue_holds.sql

# SCRUM-120: Tentative hold + FCFS (confirmed beats hold, blocked counts as unavailable).
# No migration needed - all required columns and constraints already exist from SCRUM-33/79.
psql -v ON_ERROR_STOP=1 -f /sql/tests/venue_fcfs.sql
echo "venue_fcfs database checks: PASS"

for pass in 1 2; do
  psql -v ON_ERROR_STOP=1 -f /sql/migrations/20261025120000_scrum_132_complete_event.sql > /tmp/migration-output.txt
  echo "Event completion migration pass $pass: PASS"
done

# SCRUM-41: apply twice to verify upgrade/replay safety, then check DB invariants.
for pass in 1 2; do
  psql -v ON_ERROR_STOP=1 -f /sql/migrations/20261026150854_scrum_41_registration_capacity.sql > /tmp/migration-output.txt
  echo "Registration capacity migration pass $pass: PASS"
done
psql -v ON_ERROR_STOP=1 -f /sql/tests/registration_capacity.sql

# SCRUM-40 remains additive to the capacity migration and is safe to replay.
for pass in 1 2; do
  psql -v ON_ERROR_STOP=1 -f /sql/migrations/20261029044510_scrum_40_attendee_registration.sql > /tmp/migration-output.txt
  echo "Attendee registration migration pass $pass: PASS"
done
psql -v ON_ERROR_STOP=1 -f /sql/tests/attendee_registration.sql

for pass in 1 2; do
  psql -v ON_ERROR_STOP=1 -f /sql/migrations/20261029062324_scrum_40_initial_confirmed_capacity.sql > /tmp/migration-output.txt
  echo "Initial confirmed capacity migration pass $pass: PASS"
done
psql -v ON_ERROR_STOP=1 -f /sql/tests/initial_confirmed_capacity.sql

# SCRUM-130: stop auto-assignment; the Event Coordinator Lead assigns instead.
for pass in 1 2; do
  psql -v ON_ERROR_STOP=1 -f /sql/migrations/20261030120000_scrum_130_unassigned_queue.sql > /tmp/migration-output.txt
  echo "Unassigned queue migration pass $pass: PASS"
done
psql -v ON_ERROR_STOP=1 -f /sql/tests/coordinator_assignment.sql
echo "coordinator_assignment database checks: PASS"

# SCRUM-49 / R07: hybrid notification recipient model (recipient_id OR recipient_role).
# Applied twice to prove the drop/recreate constraints and add-column-if-not-exists are
# replay-safe.
for pass in 1 2; do
  psql -v ON_ERROR_STOP=1 -f /sql/migrations/20261030015221_scrum_49_notification_recipient_role.sql > /tmp/migration-output.txt
  echo "Notification recipient-role migration pass $pass: PASS"
done

# SCRUM-43: withdrawal conditions, transactional receipt and backend-only RPCs.
for pass in 1 2; do
  psql -v ON_ERROR_STOP=1 -f /sql/migrations/20261030062503_scrum_43_withdraw_registration.sql > /tmp/migration-output.txt
  echo "Registration withdrawal migration pass $pass: PASS"
done
psql -v ON_ERROR_STOP=1 -f /sql/tests/registration_withdrawal.sql

# SCRUM-141 (R12): atomic failed-login increment + lockout. Applied twice to prove the
# create-or-replace function is replay-safe.
for pass in 1 2; do
  psql -v ON_ERROR_STOP=1 -f /sql/migrations/20261030140000_scrum_141_atomic_failed_login.sql > /tmp/migration-output.txt
  echo "Atomic failed-login migration pass $pass: PASS"
done

# SCRUM-69: cancel an event, release its resources and notify attendees atomically.
for pass in 1 2; do
  psql -v ON_ERROR_STOP=1 -f /sql/migrations/20261030180000_scrum_69_cancel_event.sql > /tmp/migration-output.txt
  echo "Event cancellation migration pass $pass: PASS"
done
