"""Validate event details before saving. Drafts may leave required fields blank."""

from datetime import UTC, datetime

# Keep these limits in sync with the form and supabase/create_events.sql.
TEXT_LIMITS = {
    "title": 200,
    "description": 5000,
    "purpose": 2000,
    "category": 100,
    "venue_requirements": 2000,
    "accessibility_requirements": 2000,
    "equipment_requirements": 2000,
    "registration_requirements": 2000,
}
REQUIRED_TEXT = ("title", "description", "purpose", "category")


def validate_event(data: dict, *, submitting: bool) -> tuple[dict, dict]:
    """Return cleaned database fields and field-specific errors, without saving."""
    fields = {}
    errors = {}

    for name, limit in TEXT_LIMITS.items():
        value = data.get(name)
        if value is None:
            value = ""
        if not isinstance(value, str):
            errors[name] = "Enter text."
            continue
        value = value.strip()
        fields[name] = value or None
        if len(value) > limit:
            errors[name] = f"Use {limit} characters or fewer."
        elif submitting and name in REQUIRED_TEXT and not value:
            errors[name] = "This field is required to submit."

    attendance = data.get("expected_attendance")
    fields["expected_attendance"] = attendance
    if attendance is None:
        if submitting:
            errors["expected_attendance"] = "Enter the expected attendance."
    elif type(attendance) is not int or not 1 <= attendance <= 2_147_483_647:
        # bool is an int subclass in Python; type(...) also rejects true/false.
        errors["expected_attendance"] = "Enter a whole number between 1 and 2147483647."

    value = data.get("event_datetime")
    fields["event_datetime"] = None
    if value is None or value == "":
        if submitting:
            errors["event_datetime"] = "Choose a preferred date and time."
    else:
        try:
            if not isinstance(value, str):
                raise ValueError()
            event_time = datetime.fromisoformat(value)
            if event_time.tzinfo is None or event_time.utcoffset() is None:
                raise ValueError()
            event_time = event_time.astimezone(UTC)
            if event_time < datetime.now(UTC):
                errors["event_datetime"] = "Choose a date and time that is not in the past."
            else:
                fields["event_datetime"] = event_time.isoformat()
        except (ValueError, OverflowError):
            errors["event_datetime"] = "Enter a valid date and time including its time zone."

    return fields, errors
