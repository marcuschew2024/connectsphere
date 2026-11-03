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
the two from disagreeing. See Decision Log D60.
"""

from .booking_repository import list_active_bookings_for_venue
from .venue_overlap import BookingInterval, OverlapEngine, _as_utc
from .venue_unavailability_repository import list_unavailability


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


def _maintenance_slot(block: dict) -> dict:
    """Shape one active maintenance block for the conflict report."""
    return {
        "id": block.get("id"),
        "start_at": block.get("start_at"),
        "end_at": block.get("end_at"),
        "reason": block.get("reason"),
        "note": block.get("note"),
    }


def maintenance_conflict_report(venue: dict) -> list[dict]:
    """Bookings a venue's buffer change pushed into an active maintenance block (audit A3).

    R5/SCRUM-169 keeps occupied windows consistent when a booking or block is *created*. A
    buffer change instead edits existing bookings' occupied windows in place (SCRUM-129/137),
    so raising a buffer can slide a booking that merely touched a maintenance block into
    overlapping it. The booking-vs-booking report above never looks at maintenance, so that
    clash went unreported. Those bookings are identified and flagged (Week 7 #1: identify,
    don't remove) - nothing here mutates, cancels or rejects anything.

    Only NEW overlaps are reported: a booking that already overlapped the block on its raw
    published times is not a consequence of the buffer change. Maintenance blocks occupy their
    exact window (no buffers of their own), so the booking's buffered occupied interval is
    compared against the block's raw window.
    """
    setup_minutes = max(0, int(venue.get("setup_time_minutes") or 0))
    turnaround_minutes = max(0, int(venue.get("turnaround_time_minutes") or 0))
    if not setup_minutes and not turnaround_minutes:
        return []
    blocks = list_unavailability(str(venue["id"]))
    if not blocks:
        return []
    windows = [(block, _as_utc(block["start_at"]), _as_utc(block["end_at"])) for block in blocks]
    findings: list[dict] = []
    for record in list_active_bookings_for_venue(str(venue["id"])):
        raw = BookingInterval.from_record(record, 0, 0)
        # An expired tentative hold no longer occupies the room (SCRUM-79).
        if raw.status in OverlapEngine.TENTATIVE_STATUSES and raw.is_expired():
            continue
        buffered = BookingInterval.from_record(record, setup_minutes, turnaround_minutes)
        clashing = [
            block for block, b_start, b_end in windows
            if not raw.overlaps_published(b_start, b_end) and buffered.overlaps(b_start, b_end)
        ]
        if clashing:
            findings.append({
                **_slot(record, setup_minutes, turnaround_minutes),
                "reason": (
                    f"Booking occupies {buffered.occupied_start.isoformat()} to "
                    f"{buffered.occupied_end.isoformat()} with buffers, overlapping "
                    f"{len(clashing)} maintenance block(s)."
                ),
                "maintenance_blocks": [_maintenance_slot(block) for block in clashing],
            })
    return findings
