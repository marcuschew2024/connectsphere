"""SCRUM-129 AC3: report the bookings a venue's buffer change made conflicting.

Raising a venue's setup or turnaround time can make bookings that were comfortably
back-to-back overlap. The acceptance criterion is that those bookings are *identified and
flagged*, never silently removed or rewritten, so a human decides what happens to them.

The detection itself is the overlap engine's pure `identify_problematic_bookings`. This
module shapes its output for the API and composes it with the repository read, so nothing
here mutates a booking.

The report is computed on demand rather than stored. `problematic_venue_bookings` (the
table SCRUM-137 introduces) is the durable home for the same facts; computing on demand
keeps this report working whether or not that migration has been applied yet, and keeps
the two from disagreeing. See Decision Log D58.
"""

from .booking_repository import list_active_bookings_for_venue
from .venue_overlap import BookingInterval, OverlapEngine


def _slot(record: dict, setup_minutes: int, turnaround_minutes: int) -> dict:
    interval = BookingInterval.from_record(record, setup_minutes, turnaround_minutes)
    event = record.get("event") or {}
    return {
        "booking_id": record.get("id"),
        "reference": record.get("reference"),
        "event_id": record.get("event_id"),
        "event_title": event.get("title"),
        "status": record.get("status"),
        "start_at": interval.start_at.isoformat(),
        "end_at": interval.end_at.isoformat(),
        "occupied_start": interval.occupied_start.isoformat(),
        "occupied_end": interval.occupied_end.isoformat(),
    }


def summarise(entry: dict, setup_minutes: int, turnaround_minutes: int) -> dict:
    """Shape one engine finding into the API's conflict record."""
    return {
        **_slot(entry["booking"], setup_minutes, turnaround_minutes),
        "reason": entry["reason"],
        "conflicts_with": [
            _slot(other, setup_minutes, turnaround_minutes)
            for other in entry["conflicts_with"]
        ],
    }


def buffer_conflict_report(venue: dict) -> list[dict]:
    """Bookings of this venue that conflict only because of its setup/turnaround buffers.

    Pairs that already overlapped on their published times are left out: they are not a
    consequence of the buffer change and are not what this report asks a human to resolve.
    """
    setup_minutes = max(0, int(venue.get("setup_time_minutes") or 0))
    turnaround_minutes = max(0, int(venue.get("turnaround_time_minutes") or 0))
    if not setup_minutes and not turnaround_minutes:
        return []
    findings = OverlapEngine().identify_problematic_bookings(
        str(venue["id"]),
        list_active_bookings_for_venue(str(venue["id"])),
        setup_minutes,
        turnaround_minutes,
    )
    return [summarise(entry, setup_minutes, turnaround_minutes) for entry in findings]


def buffers_changed(before: dict, after: dict) -> bool:
    """True when a save altered either buffer, so the report is worth recomputing."""
    return any(
        int(before.get(field) or 0) != int(after.get(field) or 0)
        for field in ("setup_time_minutes", "turnaround_time_minutes")
    )
