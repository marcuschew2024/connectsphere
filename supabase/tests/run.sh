#!/bin/sh
# Run inside the disposable compose database container: sh /sql/tests/run.sh
set -eu
export PGUSER=postgres PGDATABASE=connectsphere
psql -v ON_ERROR_STOP=1 -f /sql/tests/bootstrap.sql
for pass in 1 2; do
  for migration in seed_users create_events login_auth rbac edit_planning event_decision_notifications auto_assign_coordinator request_clarification; do
    psql -v ON_ERROR_STOP=1 -f "/sql/$migration.sql" > /tmp/migration-output.txt
  done
  echo "Migration pass $pass: PASS"
done
for check in drafts assignment; do
  psql -v ON_ERROR_STOP=1 -f "/sql/tests/$check.sql"
  echo "$check database checks: PASS"
done
psql -v ON_ERROR_STOP=1 <<'SQL'
update public.app_users set email = 'organiser@connectsphere.test' where id = 1;
insert into public.app_users (id, display_name, role, is_demo, email) values
  (6, 'Organiser B', 'Organiser', true, 'organiser-b@connectsphere.test'),
  (7, 'Coordinator B', 'Coordinator', true, 'coordinator-b@connectsphere.test');
notify pgrst, 'reload schema';
SQL
