#!/bin/sh
# SCRUM-169: two actual transactions, both orderings. Disposable DB only.
set -eu
export PGUSER=postgres PGDATABASE=connectsphere
scratch=$(mktemp -d)
room=$(psql -XAtc 'select gen_random_uuid()')
event=$(psql -XAtc 'select gen_random_uuid()')
first_pid='' second_pid=''
cleanup() {
  [ -z "$first_pid" ] || kill "$first_pid" 2>/dev/null || true
  [ -z "$second_pid" ] || kill "$second_pid" 2>/dev/null || true
  psql -Xq -c "delete from public.venue_unavailability where venue_id='$room'; delete from public.events where id='$event'; delete from public.venues where id='$room';" >/dev/null
  rm -rf "$scratch"
}
trap cleanup EXIT
psql -Xq -v ON_ERROR_STOP=1 <<SQL
insert into public.venues (id,name,location,capacity,facilities,accessibility,supported_layouts,operating_hours,setup_time_minutes,turnaround_time_minutes,created_by)
values ('$room','R5 concurrency','Disposable',100,'{}','{}','{Classroom}','{"monday":{"opens":"00:00","closes":"23:59"},"tuesday":null,"wednesday":null,"thursday":null,"friday":null,"saturday":null,"sunday":null}',30,45,3);
insert into public.events (id,title,description,purpose,category,event_datetime,expected_attendance,status,organiser_id,coordinator_id,submitted_at)
values ('$event','R5 concurrency','Preserve','Learn','Workshop','2099-10-20T02:00:00Z',10,'Planning',1,2,now());
SQL
booking="insert into public.venue_bookings(event_id,venue_id,start_at,end_at,expected_attendance,layout,requested_by,status) values('$event','$room','2099-10-20T02:00:00Z','2099-10-20T04:00:00Z',10,'Classroom',2,'Confirmed');"
block="insert into public.venue_unavailability(venue_id,start_at,end_at,reason,created_by) values('$room','2099-10-20T01:45:00Z','2099-10-20T02:00:00Z','Maintenance',3);"
for ordering in booking-first block-first; do
  psql -Xq -c "delete from public.venue_unavailability where venue_id='$room'; delete from public.venue_bookings where event_id='$event';"
  if [ "$ordering" = booking-first ]; then first=$booking; second=$block; else first=$block; second=$booking; fi
  mkfifo "$scratch/input"
  PGAPPNAME=r5_first psql -XAt -v ON_ERROR_STOP=1 <"$scratch/input" >"$scratch/first" 2>&1 & first_pid=$!
  exec 3>"$scratch/input"
  printf "begin; %s select 'READY';\n" "$first" >&3
  count=0
  until grep -q READY "$scratch/first"; do
    count=$((count+1)); [ "$count" -lt 100 ] || { cat "$scratch/first"; exit 1; }
    sleep 0.05
  done
  PGAPPNAME=r5_second psql -XAt -v ON_ERROR_STOP=1 -c "$second" >"$scratch/second" 2>&1 & second_pid=$!
  count=0
  until [ "$(psql -XAtc "select count(*) from pg_stat_activity where application_name='r5_second' and wait_event_type='Lock'")" = 1 ]; do
    count=$((count+1)); [ "$count" -lt 100 ] || { cat "$scratch/second"; exit 1; }
    sleep 0.05
  done
  printf 'commit;\n\\q\n' >&3
  exec 3>&-
  wait "$first_pid"; first_pid=''
  if wait "$second_pid"; then result=0; else result=$?; fi
  second_pid=''
  if [ "$ordering" = booking-first ]; then
    [ "$result" = 0 ] || { cat "$scratch/second"; exit 1; }
    # The previously committed booking must be identifiable as affected.
    [ "$(psql -XAtc "select count(*) from public.venue_bookings b join public.venue_unavailability u on b.venue_id=u.venue_id where b.event_id='$event' and b.occupied_start<u.end_at and b.occupied_end>u.start_at")" = 1 ]
  else
    [ "$result" != 0 ]
    grep -q 'unavailable during the event or its setup/turnaround time' "$scratch/second"
    [ "$(psql -XAtc "select count(*) from public.venue_bookings where event_id='$event'")" = 0 ]
  fi
  rm "$scratch/input"
  echo "Maintenance concurrency $ordering: PASS"
done
