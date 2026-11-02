#!/bin/sh
# SCRUM-137: real competing SQL transactions; never run against the hosted database.
set -eu
export PGUSER=postgres PGDATABASE=connectsphere
scratch=$(mktemp -d)
room=$(psql -XAtc 'select gen_random_uuid()')
event=$(psql -XAtc 'select gen_random_uuid()')
first_pid='' second_pid=''
cleanup() {
  [ -z "$first_pid" ] || kill "$first_pid" 2>/dev/null || true
  [ -z "$second_pid" ] || kill "$second_pid" 2>/dev/null || true
  psql -Xq -c "delete from public.events where id='$event'; delete from public.venues where id='$room';" >/dev/null
  rm -rf "$scratch"
}
trap cleanup EXIT
psql -Xq -v ON_ERROR_STOP=1 <<SQL
insert into public.venues (id,name,location,capacity,facilities,accessibility,supported_layouts,operating_hours,setup_time_minutes,turnaround_time_minutes,created_by)
values ('$room','R1 concurrency','Disposable',100,'{}','{}','{Classroom}','{"monday":{"opens":"00:00","closes":"23:59"},"tuesday":null,"wednesday":null,"thursday":null,"friday":null,"saturday":null,"sunday":null}',15,30,3);
insert into public.events (id,title,description,purpose,category,event_datetime,expected_attendance,status,organiser_id,coordinator_id,submitted_at)
values ('$event','R1 concurrency','Preserve','Learn','Workshop','2099-10-20T04:00:00Z',10,'Planning',1,2,now());
SQL
insert_slot() {
  printf "insert into public.venue_bookings(event_id,venue_id,start_at,end_at,expected_attendance,layout,requested_by,status) values('%s','%s','2099-10-20T%s:00Z','2099-10-20T%s:00Z',10,'Classroom',2,'%s');" "$event" "$room" "$1" "$2" "$3"
}
for ordering in booking-first buffer-first two-bookings two-approvals repeatable-read; do
  psql -Xq -v ON_ERROR_STOP=1 -c "delete from public.venue_bookings where event_id='$event'; update public.venues set setup_time_minutes=15,turnaround_time_minutes=30 where id='$room';"
  increase="update public.venues set turnaround_time_minutes=60 where id='$room';"
  isolation='read committed'
  case "$ordering" in
    booking-first|buffer-first)
      psql -Xq -v ON_ERROR_STOP=1 -c "$(insert_slot 04:00 05:00 Confirmed)"
      candidate=$(insert_slot 06:00 07:00 Confirmed)
      if [ "$ordering" = booking-first ]; then first=$candidate; second=$increase; else first=$increase; second=$candidate; fi ;;
    two-bookings|repeatable-read)
      first=$(insert_slot 06:00 07:00 Confirmed)
      second=$(insert_slot 07:30 08:30 Confirmed)
      [ "$ordering" != repeatable-read ] || isolation='repeatable read' ;;
    two-approvals)
      psql -Xq -v ON_ERROR_STOP=1 -c "update public.venues set setup_time_minutes=0,turnaround_time_minutes=0 where id='$room'; $(insert_slot 06:00 07:00 Requested) $(insert_slot 07:30 08:30 Requested) update public.venues set setup_time_minutes=15,turnaround_time_minutes=30 where id='$room';"
      first="update public.venue_bookings set status='Confirmed' where venue_id='$room' and start_at='2099-10-20T06:00:00Z';"
      second="update public.venue_bookings set status='Confirmed' where venue_id='$room' and start_at='2099-10-20T07:30:00Z';" ;;
  esac
  mkfifo "$scratch/input"
  PGAPPNAME=r1_first psql -XAt -v ON_ERROR_STOP=1 <"$scratch/input" >"$scratch/first" 2>&1 & first_pid=$!
  exec 3>"$scratch/input"
  printf "begin; %s select 'READY';\n" "$first" >&3
  count=0
  until grep -q READY "$scratch/first"; do
    count=$((count+1)); [ "$count" -lt 100 ] || { cat "$scratch/first"; exit 1; }
    sleep 0.05
  done
  PGAPPNAME=r1_second psql -XAt -v ON_ERROR_STOP=1 -c "begin isolation level $isolation; $second commit;" >"$scratch/second" 2>&1 & second_pid=$!
  count=0
  until [ "$(psql -XAtc "select count(*) from pg_stat_activity where application_name='r1_second' and wait_event_type='Lock'")" = 1 ]; do
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
    [ "$(psql -XAtc "select count(*) from public.problematic_venue_bookings where venue_id='$room'")" = 1 ]
    [ "$(psql -XAtc "select count(*) from public.venue_bookings where venue_id='$room' and turnaround_minutes=60")" = 2 ]
  else
    [ "$result" != 0 ] || { cat "$scratch/second"; exit 1; }
    if [ "$ordering" = repeatable-read ]; then
      grep -q 'could not serialize access' "$scratch/second"
    else
      grep -q 'overlaps an occupied setup/turnaround window' "$scratch/second"
    fi
    [ "$(psql -XAtc "select count(*) from public.venue_bookings where venue_id='$room' and status='Confirmed'")" = 1 ]
  fi
  rm "$scratch/input"
  echo "Buffer concurrency $ordering: PASS"
done

# Replay must also work WITH unresolved, deliberately preserved buffer conflicts.
psql -Xq -v ON_ERROR_STOP=1 -c "delete from public.venue_bookings where event_id='$event'; update public.venues set setup_time_minutes=15,turnaround_time_minutes=30 where id='$room'; $(insert_slot 04:00 05:00 Confirmed) $(insert_slot 06:00 07:00 Confirmed) update public.venues set turnaround_time_minutes=60 where id='$room';"
psql -Xq -v ON_ERROR_STOP=1 -f /sql/migrations/20261102171833_scrum_137_preserve_buffer_conflicts.sql >"$scratch/replay" 2>&1
[ "$(psql -XAtc "select count(*) from public.problematic_venue_bookings where venue_id='$room'")" = 1 ]
[ "$(psql -XAtc "select count(*) from public.venue_bookings where venue_id='$room' and status='Confirmed' and turnaround_minutes=60")" = 2 ]
echo 'Migration replay with unresolved buffer conflicts: PASS'
