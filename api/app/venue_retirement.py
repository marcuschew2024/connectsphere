"""Business rules for retiring a venue (SCRUM-26).

A small, DB-independent value object in the shape of EventCancellation: it decides
whether a venue can be retired, and what a retired venue still allows. It has no
persistence, so it is unit-testable in isolation; the retire_venue database function
re-checks the same rules under a row lock and records who retired the venue and when.

Team decision (Decision Log D35):
  * only Venue Staff retire a venue (the story's actor, and the role that manages
    the catalogue - SCRUM-24/25);
  * a venue with booking requests still waiting for a decision cannot be retired,
    so staff decide them first and nothing is rejected on their behalf;
  * Confirmed bookings are never changed, and the venue row and its history stay;
  * a retired venue takes no new or moved bookings, drops out of Coordinators'
    catalogue, search and suitability ranking, and its details are read-only.
"""


class VenueRetirement:
    """Retirement rules for one venue row."""

    # Booking requests that still need a Venue Staff decision.
    OUTSTANDING_STATUSES = frozenset({"Requested", "Pending", "Held"})

    @staticmethod
    def from_payload(payload) -> None:
        """Retiring takes no details: the actor and time are recorded by the server."""
        if payload is not None and payload != {}:
            raise ValueError(
                "Retiring a venue takes no details. Who retired it and when are recorded "
                "automatically."
            )

    @staticmethod
    def is_retired(venue) -> bool:
        return isinstance(venue, dict) and venue.get("is_retired") is True

    @classmethod
    def blocking_reason(cls, venue) -> str | None:
        """Why this venue cannot be retired now, or None when it can."""
        if cls.is_retired(venue):
            return "This venue is already retired."
        return None

    @staticmethod
    def outstanding_reason(count: int) -> str:
        noun = "request" if count == 1 else "requests"
        return (
            f"Decide the {count} outstanding booking {noun} for this venue before "
            "retiring it."
        )

    @classmethod
    def booking_refusal(cls, venue) -> str | None:
        """A retired venue is no longer offered for new or moved bookings."""
        if cls.is_retired(venue):
            return "This venue is retired and no longer accepts bookings."
        return None

    @classmethod
    def edit_refusal(cls, venue) -> str | None:
        """A retired venue's details are kept as they were for historical records."""
        if cls.is_retired(venue):
            return "This venue is retired. Its details are kept for history and cannot be edited."
        return None
