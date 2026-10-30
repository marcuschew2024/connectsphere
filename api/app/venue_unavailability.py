"""Pure validation and overlap rules for venue unavailability blocks."""

from datetime import datetime

REASONS = {
    "Maintenance",
    "Renovation",
    "Safety",
    "Failure",
    "Emergency",
    "Internal activity",
}
ACTIVE_BOOKING_STATUSES = {"Requested", "Pending", "Held", "Confirmed"}


def parse_timestamp(value: object, field: str) -> tuple[str | None, str | None]:
    if not isinstance(value, str) or not value.strip():
        return None, f"{field} is required."
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None, f"{field} must be an ISO timestamp."
    if parsed.tzinfo is None:
        return None, f"{field} must include a timezone."
    return parsed.isoformat().replace("+00:00", "Z"), None


def validate_block(data: object) -> tuple[dict | None, dict[str, str]]:
    if not isinstance(data, dict):
        return None, {"payload": "Send block details as a JSON object."}
    allowed = {"start_at", "end_at", "reason", "note"}
    if set(data) - allowed:
        return None, {"payload": "Send only start_at, end_at, reason and note."}

    start_at, start_error = parse_timestamp(data.get("start_at"), "Start time")
    end_at, end_error = parse_timestamp(data.get("end_at"), "End time")
    errors = {}
    if start_error:
        errors["start_at"] = start_error
    if end_error:
        errors["end_at"] = end_error

    reason = data.get("reason")
    if reason not in REASONS:
        errors["reason"] = "Choose a supported unavailability reason."

    if not errors:
        start = datetime.fromisoformat(start_at.replace("Z", "+00:00"))
        end = datetime.fromisoformat(end_at.replace("Z", "+00:00"))
    else:
        start = end = None
    if start is not None and end is not None and start >= end:
        errors["end_at"] = "End time must be after start time."

    note = data.get("note")
    if note is not None:
        if not isinstance(note, str) or len(note) > 2000:
            errors["note"] = "Keep the note within 2000 characters."
        else:
            note = note.strip() or None

    if errors:
        return None, errors
    return {"start_at": start_at, "end_at": end_at, "reason": reason, "note": note}, {}


def overlaps(start_at: str, end_at: str, other_start: str, other_end: str) -> bool:
    return start_at < other_end and end_at > other_start


def check_block_overlap(
    start_at: str,
    end_at: str,
    existing_blocks: list[dict],
) -> dict | None:
    """Return the first overlapping active block, or None."""
    for block in existing_blocks:
        if overlaps(start_at, end_at, block["start_at"], block["end_at"]):
            return block
    return None
