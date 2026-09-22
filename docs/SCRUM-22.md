# SCRUM-22: Request clarification/amendment (CONFLICT J2)

J2 was confirmed in scope. The implementation uses a separate clarification record;
the event remains internally `Submitted` and is shown to customers as `Planning`.

Run [`supabase/request_clarification.sql`](../supabase/request_clarification.sql) after
`create_events.sql` and `event_decision_notifications.sql`.

## Workflow

1. The assigned Coordinator posts a required clarification note to
   `POST /events/<event_id>/clarification`.
2. The note, Coordinator, and request time are stored in `event_clarifications`.
   An in-app notification is sent to the Organiser.
3. The pending request is removed from the Coordinator queue until the Organiser
   responds. The Organiser can view the note at
   `GET /events/<event_id>/clarification`.
4. The Organiser revises the complete request and posts it to
   `POST /events/<event_id>/resubmit`.
5. The live event details are updated, the clarification is marked `Resubmitted`,
   and the request returns to the Coordinator queue.

`event_status_history` now also records `action` and `note`. Clarification request and
resubmission actions therefore retain the actor and database timestamp alongside the
note. The Coordinator cannot resubmit or approve/reject while a clarification is
pending, and the Organiser cannot request clarification.
