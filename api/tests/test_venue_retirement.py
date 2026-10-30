"""Unit tests for the SCRUM-26 VenueRetirement rules (Decision Log D35).

Pure rules only. The endpoint is covered in test_venue_retirement_route.py and the
transactional retire_venue() function in test_venue_retirement_acceptance.py.
"""

import pytest

from app.venue_retirement import VenueRetirement

ACTIVE = {"id": "venue-1", "is_retired": False}
RETIRED = {"id": "venue-1", "is_retired": True}


@pytest.mark.parametrize("payload", [None, {}])
def test_retiring_takes_no_details(payload):
    assert VenueRetirement.from_payload(payload) is None


# The actor and time are server-owned, so a client cannot supply them.
@pytest.mark.parametrize("payload", [
    {"retired_by": 3}, {"retired_at": "2026-10-31T00:00:00Z"}, {"reason": "Closed"},
    [], "retire", 1, {"is_retired": True},
])
def test_any_supplied_detail_is_refused(payload):
    with pytest.raises(ValueError, match="recorded automatically"):
        VenueRetirement.from_payload(payload)


@pytest.mark.parametrize("venue,expected", [
    (RETIRED, True), (ACTIVE, False), ({"id": "venue-1"}, False),
    ({"is_retired": "true"}, False), ({"is_retired": 1}, False), (None, False), ([], False),
])
def test_only_an_explicit_retired_flag_counts(venue, expected):
    assert VenueRetirement.is_retired(venue) is expected


def test_an_active_venue_can_be_retired():
    assert VenueRetirement.blocking_reason(ACTIVE) is None


def test_a_venue_is_retired_only_once():
    assert VenueRetirement.blocking_reason(RETIRED) == "This venue is already retired."


@pytest.mark.parametrize("count,text", [
    (1, "Decide the 1 outstanding booking request for this venue before retiring it."),
    (3, "Decide the 3 outstanding booking requests for this venue before retiring it."),
])
def test_outstanding_requests_are_counted_in_the_refusal(count, text):
    assert VenueRetirement.outstanding_reason(count) == text


def test_outstanding_requests_are_those_awaiting_a_decision():
    assert VenueRetirement.OUTSTANDING_STATUSES == {"Requested", "Pending", "Held"}
    assert "Confirmed" not in VenueRetirement.OUTSTANDING_STATUSES


def test_a_retired_venue_takes_no_new_bookings():
    assert VenueRetirement.booking_refusal(RETIRED) == (
        "This venue is retired and no longer accepts bookings."
    )
    assert VenueRetirement.booking_refusal(ACTIVE) is None


def test_a_retired_venue_is_read_only():
    assert "cannot be edited" in VenueRetirement.edit_refusal(RETIRED)
    assert VenueRetirement.edit_refusal(ACTIVE) is None
