#!/bin/sh
# Run inside the disposable compose database container: sh /sql/tests/run.sh
set -eu
export PGUSER=postgres PGDATABASE=connectsphere
psql -v ON_ERROR_STOP=1 -f /sql/tests/bootstrap.sql
for pass in 1 2; do
  for migration in seed_users create_events login_auth rbac edit_planning event_decision_notifications auto_assign_coordinator request_clarification create_venues; do
    psql -v ON_ERROR_STOP=1 -f "/sql/$migration.sql" > /tmp/migration-output.txt
  done
  echo "Migration pass $pass: PASS"
done
for check in drafts assignment venues; do
  psql -v ON_ERROR_STOP=1 -f "/sql/tests/$check.sql"
  echo "$check database checks: PASS"
done
psql -v ON_ERROR_STOP=1 <<'SQL'
insert into public.app_users (id, display_name, role, is_demo) values
  (6, 'Organiser B', 'Organiser', true),
  (7, 'Coordinator B', 'Coordinator', true);
-- Test-fixture cleanup only; this grant is absent from the application migration.
grant delete on public.venues to service_role;
notify pgrst, 'reload schema';
SQL
