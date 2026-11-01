# SCRUM-137: Reconcile venue setup and turnaround buffers

## Outcome

Venue search, availability calendar, booking application checks, booking approval, and
the database exclusion constraints now apply the same occupied interval:

`[start_at - setup_time_minutes, end_at + turnaround_time_minutes)`

Touching occupied boundaries remain compatible.

## Verification

- Unit coverage: setup, turnaround, boundary, and existing-conflict cases.
- Route coverage: venue search and availability calendar pass venue buffers.
- Integration coverage: booking creation and approval apply the same buffers.
- Database coverage: bookings snapshot venue buffers and exclusion constraints protect
  confirmed and tentative occupied intervals under concurrency.
- Existing conflicting bookings are preserved and recorded in
  `problematic_venue_bookings`.

## Human review

Jessica owns the PO rule. Ernest reviews the database migration and concurrency design.
