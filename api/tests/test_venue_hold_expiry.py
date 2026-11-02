"""SCRUM-79: releasing an expired tentative hold and telling its Coordinator.

The pure rules are tested without a database; the sweep is tested against fakes for the
repository and the notification writer, so what is asserted is the behaviour the ACs ask
for (the slot is released, the right person hears about it) rather than the SQL.
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from werkzeug.exceptions import Conflict, ServiceUnavailable

from app.venue_hold_expiry import (
    expiry_notice,
    hold_notice_recipient,
    is_hold_expired,
    release_expired_holds,
)

NOW = datetime(2099, 10, 15, 12, 0, 0, tzinfo=UTC)


def hold(**overrides):
    return {
        "id": "booking-1",
        "event_id": "event-1",
        "status": "Held",
        "requested_by": 2,
        "expires_at": (NOW - timedelta(hours=1)).isoformat(),
        **overrides,
    }


# --- pure rules ---------------------------------------------------------------


def test_a_hold_past_its_deadline_is_expired():
    """AC4: once the deadline passes the hold no longer holds the venue."""
    assert is_hold_expired(hold(), as_of=NOW) is True


def test_a_hold_before_its_deadline_is_not_expired():
    assert is_hold_expired(hold(expires_at=(NOW + timedelta(hours=1)).isoformat()), NOW) is False


def test_the_deadline_is_inclusive():
    """Matches BookingInterval.is_expired, so the two layers agree on the boundary."""
    at_deadline = hold(expires_at=NOW.isoformat())
    assert is_hold_expired(at_deadline, as_of=NOW) is True
    assert is_hold_expired(at_deadline, as_of=NOW - timedelta(seconds=1)) is False


@pytest.mark.parametrize("status", ["Confirmed", "Blocked", "Rejected", "Cancelled", "Expired"])
def test_only_a_hold_can_expire(status):
    """A decided booking is never released by a deadline it happens to still carry.

    This is the rule that keeps an approved-from-hold booking occupying its slot.
    """
    assert is_hold_expired(hold(status=status), as_of=NOW) is False


def test_a_hold_without_a_deadline_never_expires():
    assert is_hold_expired(hold(expires_at=None), as_of=NOW) is False


def test_the_notice_names_the_event_and_says_the_venue_is_free():
    message = expiry_notice(hold(), {"title": "Science Fair"})

    assert "Science Fair" in message
    assert "expired" in message
    assert "available" in message


def test_the_notice_survives_an_event_it_cannot_name():
    assert "your event" in expiry_notice(hold(), None)


def test_the_notice_goes_to_the_events_current_coordinator():
    """SCRUM-21/130: a reassignment moves the arrangements, so B hears about them."""
    assert hold_notice_recipient(hold(requested_by=2), {"coordinator_id": 7}) == 7


def test_the_notice_falls_back_to_the_requester_when_the_event_is_unreadable():
    assert hold_notice_recipient(hold(requested_by=2), None) == 2
    assert hold_notice_recipient(hold(requested_by=2), {"coordinator_id": None}) == 2


def test_an_unattributable_release_notifies_nobody_rather_than_guessing():
    assert hold_notice_recipient({"requested_by": None}, {}) is None


# --- the sweep ----------------------------------------------------------------


@pytest.fixture
def sweep(app, monkeypatch):
    notices = []
    released = [hold()]
    calls = {}

    def expire(venue_id=None, as_of=None):
        calls["venue_id"] = venue_id
        return released

    monkeypatch.setattr("app.venue_hold_expiry.expire_holds", expire)
    monkeypatch.setattr(
        "app.venue_hold_expiry.get_event_by_id",
        lambda event_id: {"id": event_id, "title": "Science Fair", "coordinator_id": 7},
    )
    monkeypatch.setattr(
        "app.venue_hold_expiry.create_notification",
        lambda *args, **kwargs: notices.append((args, kwargs)),
    )
    return app, notices, released, calls


def test_the_sweep_releases_the_slot_and_notifies_the_current_coordinator(sweep):
    """AC4 + AC5 together: the hold is released and its Coordinator is told."""
    app, notices, released, calls = sweep

    with app.app_context():
        assert release_expired_holds("venue-1") == released

    assert calls["venue_id"] == "venue-1"
    assert len(notices) == 1
    (recipient, event_id, kind, message), kwargs = notices[0]
    assert recipient == 7, "the Coordinator who holds the event now, not requested_by (2)"
    assert (event_id, kind) == ("event-1", "booking_hold_expired")
    assert "Science Fair" in message
    assert kwargs["subject_id"] == "booking-1"


def test_the_sweep_is_opportunistic_and_never_breaks_its_caller(sweep, monkeypatch):
    """The database trigger is the authority for freeing the slot.

    A sweep failure must not turn a working booking request into a 500, so it is logged
    and swallowed -- the same posture as rbac.log_access_denied.
    """
    app, notices, _, _ = sweep

    def boom(venue_id=None, as_of=None):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr("app.venue_hold_expiry.expire_holds", boom)

    with app.app_context():
        assert release_expired_holds("venue-1") == []
    assert notices == []


def test_a_failed_notice_does_not_abandon_the_remaining_releases(sweep, monkeypatch):
    app, notices, released, _ = sweep
    released.append(hold(id="booking-2", event_id="event-2"))
    attempts = []

    def flaky(*args, **kwargs):
        attempts.append(args[0])
        if len(attempts) == 1:
            raise RuntimeError("notification store down")
        notices.append((args, kwargs))

    monkeypatch.setattr("app.venue_hold_expiry.create_notification", flaky)

    with app.app_context():
        assert len(release_expired_holds()) == 2
    assert len(attempts) == 2, "the second Coordinator is still told"
    assert len(notices) == 1


# --- persistence ---------------------------------------------------------------


def test_a_datetime_deadline_is_accepted_as_well_as_an_iso_string():
    """Rows arrive as ISO text from PostgREST, but callers may pass real datetimes."""
    assert is_hold_expired(hold(expires_at=NOW - timedelta(minutes=1)), as_of=NOW) is True
    assert is_hold_expired(hold(expires_at=NOW + timedelta(minutes=1)), as_of=NOW) is False


def test_a_release_nobody_can_be_attributed_to_is_skipped_not_guessed(sweep, monkeypatch):
    """With no current Coordinator and no requester there is no one to tell."""
    app, notices, released, _ = sweep
    released[:] = [hold(requested_by=None)]
    monkeypatch.setattr("app.venue_hold_expiry.get_event_by_id", lambda event_id: {})

    with app.app_context():
        assert len(release_expired_holds()) == 1, "the slot is still released"
    assert notices == [], "but no notice is invented"


def test_expire_holds_moves_lapsed_holds_and_scopes_to_one_venue(monkeypatch):
    """The repository write: only 'Held' rows at or past their deadline, for this venue."""
    from app import booking_repository as repo

    recorded = {}
    client = MagicMock()
    query = MagicMock()

    def update(payload):
        recorded["payload"] = payload
        return query

    def eq(column, value):
        recorded.setdefault("eq", {})[column] = value
        return query

    def lte(column, value):
        recorded["lte"] = (column, value)
        return query

    query.update.side_effect = update
    query.eq.side_effect = eq
    query.lte.side_effect = lte
    query.execute.return_value = SimpleNamespace(data=[{"id": "booking-1"}])
    client.table.return_value = query
    monkeypatch.setattr(repo, "get_supabase_client", lambda: client)

    released = repo.expire_holds("venue-1", as_of=NOW.isoformat())

    assert released == [{"id": "booking-1"}]
    assert recorded["payload"]["status"] == "Expired"
    assert recorded["eq"] == {"status": "Held", "venue_id": "venue-1"}
    assert recorded["lte"] == ("expires_at", NOW.isoformat())


def test_expire_holds_without_a_venue_sweeps_every_venue(monkeypatch):
    """The Venue Staff queue sweeps globally; a booking write sweeps its own venue."""
    from app import booking_repository as repo

    recorded = {}
    client = MagicMock()
    query = MagicMock()
    query.update.return_value = query
    query.eq.side_effect = lambda column, value: recorded.setdefault("eq", {}).update(
        {column: value}
    ) or query
    query.lte.return_value = query
    query.execute.return_value = SimpleNamespace(data=None)
    client.table.return_value = query
    monkeypatch.setattr(repo, "get_supabase_client", lambda: client)

    assert repo.expire_holds() == []
    assert "venue_id" not in recorded.get("eq", {})


@pytest.mark.parametrize("configured", [False, True])
def test_a_failed_release_is_explicit_and_hides_connection_details(monkeypatch, configured):
    """An outage must not look like 'nothing had expired'."""
    from app import booking_repository as repo

    client = MagicMock()
    client.table.side_effect = RuntimeError("PRIVATE connection credentials")
    monkeypatch.setattr(repo, "get_supabase_client", lambda: client if configured else None)

    with pytest.raises(ServiceUnavailable) as error:
        repo.expire_holds("venue-1")
    assert "PRIVATE" not in error.value.description
    assert "team" in error.value.description


def test_active_bookings_for_a_venue_are_listed_for_the_conflict_report(monkeypatch):
    from app import booking_repository as repo

    recorded = {}
    client = MagicMock()
    query = MagicMock()
    query.select.return_value = query
    query.eq.side_effect = lambda column, value: recorded.setdefault("eq", {}).update(
        {column: value}
    ) or query
    query.in_.side_effect = lambda column, values: recorded.setdefault(
        "in", {}
    ).update({column: list(values)}) or query
    query.order.return_value = query
    query.execute.return_value = SimpleNamespace(data=[{"id": "booking-1"}])
    client.table.return_value = query
    monkeypatch.setattr(repo, "get_supabase_client", lambda: client)

    assert repo.list_active_bookings_for_venue("venue-1") == [{"id": "booking-1"}]
    assert recorded["eq"] == {"venue_id": "venue-1"}
    assert set(recorded["in"]["status"]) == {
        "Confirmed", "Blocked", "Requested", "Pending", "Held",
    }


def test_an_empty_booking_list_is_an_empty_report_not_a_failure(monkeypatch):
    from app import booking_repository as repo

    client = MagicMock()
    client.table.return_value.select.return_value.eq.return_value.in_.return_value.order.\
        return_value.execute.return_value = SimpleNamespace(data=None)
    monkeypatch.setattr(repo, "get_supabase_client", lambda: client)

    assert repo.list_active_bookings_for_venue("venue-1") == []


@pytest.mark.parametrize("configured", [False, True])
def test_a_failed_booking_listing_does_not_look_like_a_clean_venue(monkeypatch, configured):
    """SCRUM-161's rule: an outage must not be reported as 'no conflicts'."""
    from app import booking_repository as repo

    client = MagicMock()
    client.table.side_effect = RuntimeError("PRIVATE SQL")
    monkeypatch.setattr(repo, "get_supabase_client", lambda: client if configured else None)

    with pytest.raises(ServiceUnavailable) as error:
        repo.list_active_bookings_for_venue("venue-1")
    assert "PRIVATE" not in error.value.description


@pytest.mark.parametrize(("operation", "message"), [
    (lambda repo: repo.update_requested_booking("b", {"layout": "Theatre"}, 2),
     "Requested booking can be changed"),
    (lambda repo: repo.cancel_booking("b", 2), "can be cancelled"),
])
def test_a_booking_that_changed_state_mid_request_is_a_conflict(monkeypatch, operation, message):
    """The repository's last-moment guard.

    The route checks state first, so this fires when a booking is decided between that
    check and the write. It stays a 409 rather than a silent no-op.
    """
    from app import booking_repository as repo

    client = MagicMock()
    query = MagicMock()
    query.update.return_value = query
    query.eq.return_value = query
    query.in_.return_value = query
    query.execute.return_value = SimpleNamespace(data=[])
    client.table.return_value = query
    monkeypatch.setattr(repo, "get_supabase_client", lambda: client)

    with pytest.raises(Conflict, match=message):
        operation(repo)
