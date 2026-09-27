"""Pure status mapping rules for event requests."""


class EventStatus:
    """Translate stored workflow states into customer and coordinator statuses."""

    _mapping = {
        "Draft": "Draft",
        "Submitted": "Submitted",
        "Assigned": "Submitted",
        "Under review": "Submitted",
        "Under Review": "Submitted",
        "Approved": "Planning",
        "Planning": "Planning",
        "Confirmed": "Confirmed",
        "Completed": "Completed",
        "Rejected": "Rejected",
        "Cancelled": "Cancelled",
    }

    @classmethod
    def to_visible(cls, raw_status: str | None) -> str:
        return cls._mapping.get((raw_status or "").strip(), "Planning")

    @classmethod
    def is_terminal(cls, raw_status: str | None) -> bool:
        visible = cls.to_visible(raw_status)
        if visible in {"Completed", "Rejected", "Cancelled"}:
            return True
        return False


def canonical_event_status(raw_status: str | None) -> str:
    """Return the workflow status, hiding unknown values behind Planning."""
    return EventStatus.to_visible(raw_status)


def customer_event_status(raw_status: str | None) -> str:
    """Map submitted/review states to the customer-facing Planning state."""
    visible = canonical_event_status(raw_status)
    if visible == "Submitted":
        return "Planning"
    return visible
