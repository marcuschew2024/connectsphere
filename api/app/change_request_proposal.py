"""Proposed event values in a change request (SCRUM-138, Codex review R06).

A small, DB-independent value object: it validates the values an Organiser proposes
and classifies which of them are significant. It has no persistence, so it is
unit-testable in isolation; the approve_change_request database function applies the
values atomically and records what actually changed.

Team decision (PO, Decision Log D36):
  * approving a request applies its proposed values to the event in one transaction;
  * a significant change - number of pax or venue (S1 Q7, Q11) - flags the event for
    re-review and notifies the Coordinator; nothing is cancelled or un-booked;
  * date and time are not requestable here: rescheduling is SCRUM-48. The event has
    no duration field, so a duration change stays a described (free-text) request.
"""

from .event_validation import TEXT_LIMITS, validate_event

CHANGEABLE_FIELDS = frozenset(TEXT_LIMITS) | {"expected_attendance"}
SIGNIFICANT_FIELDS = frozenset({
    "expected_attendance",
    "venue_requirements",
    "facility_requirements",
})


class ChangeRequestProposal:
    """Validated proposed values: only real changes to changeable event fields."""

    def __init__(self, changes: dict):
        self.changes = changes

    @classmethod
    def from_payload(cls, changes, event: dict) -> "ChangeRequestProposal":
        """Accept {field: new value} for changeable fields that differ from the event.

        Raises ValueError with a message, or with a {field: message} dict for
        field-specific problems.
        """
        if not isinstance(changes, dict) or not changes:
            raise ValueError("List at least one proposed change, or leave changes out.")
        unknown = set(changes) - CHANGEABLE_FIELDS
        if unknown:
            raise ValueError(
                "These details cannot be changed through a change request: "
                + ", ".join(sorted(unknown)) + "."
            )
        current = {name: event.get(name) for name in CHANGEABLE_FIELDS}
        # Validate as if submitting, so required details cannot be proposed as blank.
        fields, errors = validate_event({**current, **changes}, submitting=True)
        field_errors = {name: errors[name] for name in changes if name in errors}
        cleaned = {name: fields.get(name) for name in changes if name not in field_errors}
        for name, value in cleaned.items():
            if value == current.get(name):
                field_errors[name] = "This is already the current value."
        if field_errors:
            raise ValueError(field_errors)
        return cls(cleaned)

    def is_significant(self) -> bool:
        return bool(SIGNIFICANT_FIELDS & set(self.changes))
