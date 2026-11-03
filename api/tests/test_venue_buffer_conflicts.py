"""SCRUM-129 AC3: existing bookings made conflicting by a buffer change are reported.

The criterion is that those bookings are *identified and flagged, not silently removed*.
These tests assert both halves: the report names the right pairs, and nothing is written
to a booking while producing it.
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.venue_buffer_conflicts import buffer_conflict_report, buffers_changed, summarise
from app.venue_overlap import OverlapEngine

from .conftest import ORIGIN, select_user
from .test_venues import details

VENUE_ID = "11111111-1111-4111-8111-111111111111"
START = datetime(2099, 10, 20, 10, 0, tzinfo=UTC)


def venue(setup=0, turnaround=0):
    return {"id": VENUE_ID, "setup_time_minutes": setup, "turnaround_time_minutes": turnaround}


def slot(booking_id, offset_hours, *, hours=2, status="Confirmed", title=None):
    start = START + timedelta(hours=offset_hours)
    return {
        "id": booking_id,
        "reference": f"VB-{booking_id}",
        "venue_id": VENUE_ID,
        "event_id": f"event-{booking_id}",
        "start_at": start.isoformat(),
        "end_at": (start + timedelta(hours=hours)).isoformat(),
        "status": status,
        "event": {"title": title or f"Event {booking_id}"},
    }


# --- buffers_changed ----------------------------------------------------------


@pytest.mark.parametrize(("before", "after", "expected"), [
    ({"setup_time_minutes": 0}, {"setup_time_minutes": 30}, True),
    ({"turnaround_time_minutes": 15}, {"turnaround_time_minutes": 60}, True),
    ({"setup_time_minutes": 30}, {"setup_time_minutes": 30}, False),
    ({}, {}, False),
    ({"setup_time_minutes": None}, {"setup_time_minutes": 0}, False),
    ({"setup_time_minutes": 30}, {"setup_time_minutes": 0}, True),
])
def test_buffers_changed_detects_only_a_real_buffer_change(before, after, expected):
    """Lowering a buffer counts too: the report is recomputed whenever the rule moves."""
    assert buffers_changed(before, after) is expected


# --- the report ---------------------------------------------------------------


@pytest.fixture
def bookings(monkeypatch):
    rows = []
    monkeypatch.setattr(
        "app.venue_buffer_conflicts.list_active_bookings_for_venue", lambda venue_id: rows,
    )
    return rows


def test_back_to_back_bookings_are_reported_once_buffers_make_them_overlap(bookings):
    """The AC's own example: 10-12 and 12-14 fit until a turnaround buffer is added."""
    bookings.extend([slot("a", 0, title="Science Fair"), slot("b", 2, title="Debate Final")])

    assert buffer_conflict_report(venue()) == [], "no buffers, no conflict"

    report = buffer_conflict_report(venue(turnaround=45))

    assert len(report) == 2, "each side of the clash is listed so either can be resolved"
    titles = {entry["event_title"] for entry in report}
    assert titles == {"Science Fair", "Debate Final"}
    first = next(entry for entry in report if entry["event_title"] == "Science Fair")
    assert first["occupied_end"] == (START + timedelta(hours=2, minutes=45)).isoformat()
    assert [other["event_title"] for other in first["conflicts_with"]] == ["Debate Final"]
    assert "conflicting with 1 existing booking" in first["reason"]


def test_bookings_that_already_overlapped_are_not_blamed_on_the_buffer_change(bookings):
    """Only consequences of the new rule belong in this report.

    A pair that overlapped on its published times is a pre-existing problem, not something
    the buffer change caused, so reporting it would send staff after the wrong records.
    """
    bookings.extend([slot("a", 0), slot("b", 1)])  # 10-12 and 11-13 already overlap

    assert buffer_conflict_report(venue(setup=30, turnaround=30)) == []


def test_bookings_far_apart_stay_clear(bookings):
    bookings.extend([slot("a", 0), slot("b", 6)])

    assert buffer_conflict_report(venue(setup=60, turnaround=60)) == []


def test_the_report_never_writes_to_a_booking(bookings):
    """AC3's prohibition: identified, not silently removed or rewritten."""
    bookings.extend([slot("a", 0), slot("b", 2)])
    before = [dict(row) for row in bookings]

    buffer_conflict_report(venue(setup=30, turnaround=30))

    assert bookings == before


def test_a_report_entry_carries_what_staff_need_to_act(bookings):
    """Published slot and occupied window both appear, so the clash is explainable."""
    entry = summarise(
        {"booking": slot("a", 0), "conflicts_with": [slot("b", 2)], "reason": "because"},
        30, 45,
    )

    assert entry["booking_id"] == "a"
    assert entry["reference"] == "VB-a"
    assert entry["status"] == "Confirmed"
    assert entry["start_at"] == START.isoformat()
    assert entry["occupied_start"] == (START - timedelta(minutes=30)).isoformat()
    assert entry["occupied_end"] == (START + timedelta(hours=2, minutes=45)).isoformat()
    assert entry["reason"] == "because"
    assert entry["conflicts_with"][0]["booking_id"] == "b"


def test_a_held_booking_is_reported_like_any_other_occupant(bookings):
    """A live hold occupies the venue, so a buffer change can put it in conflict."""
    bookings.extend([slot("a", 0), slot("b", 2, status="Held")])

    assert len(buffer_conflict_report(venue(turnaround=45))) == 2


def test_the_pure_engine_is_the_detector(bookings):
    """The rule stays in the overlap engine; this module only shapes its findings."""
    bookings.extend([slot("a", 0), slot("b", 2)])

    findings = OverlapEngine().identify_problematic_bookings(VENUE_ID, bookings, 0, 45)

    assert len(findings) == len(buffer_conflict_report(venue(turnaround=45)))


# --- the routes ---------------------------------------------------------------


@pytest.fixture
def staff_api(app, monkeypatch, bookings):
    monkeypatch.setattr("app.venues.get_authenticated_user", lambda: None)
    monkeypatch.setattr("app.rbac.get_supabase_client", lambda: None)
    monkeypatch.setattr("app.venues.get_venue", lambda _: venue(turnaround=45))
    client = app.test_client()
    select_user(client, 3)
    return client


def test_staff_can_read_the_conflict_report(staff_api, bookings):
    bookings.extend([slot("a", 0, title="Science Fair"), slot("b", 2, title="Debate Final")])

    response = staff_api.get(f"/venues/{VENUE_ID}/buffer-conflicts", headers=ORIGIN)

    assert response.status_code == 200
    assert len(response.json["buffer_conflicts"]) == 2


def test_the_report_is_empty_rather_than_absent_when_nothing_conflicts(staff_api):
    response = staff_api.get(f"/venues/{VENUE_ID}/buffer-conflicts", headers=ORIGIN)

    assert response.status_code == 200
    assert response.json["buffer_conflicts"] == []


def test_an_unknown_venue_is_a_404(staff_api, monkeypatch):
    monkeypatch.setattr("app.venues.get_venue", lambda _: None)

    assert staff_api.get(
        f"/venues/{VENUE_ID}/buffer-conflicts", headers=ORIGIN,
    ).status_code == 404


@pytest.mark.parametrize("user", [1, 2, 4, 5])
def test_only_venue_staff_may_read_the_report(staff_api, user):
    """Venue Staff own the catalogue and resolve these conflicts."""
    select_user(staff_api, user)

    assert staff_api.get(
        f"/venues/{VENUE_ID}/buffer-conflicts", headers=ORIGIN,
    ).status_code == 403


# --- the save that causes the conflict ----------------------------------------


def editable_fields(**overrides):
    return {
        **{key: value for key, value in details().items() if key not in {"name", "location"}},
        "revision": 1,
        **overrides,
    }


@pytest.fixture
def editing_api(app, monkeypatch, bookings):
    """Venue Staff raising this venue's turnaround from nothing to 45 minutes."""
    monkeypatch.setattr("app.venues.get_authenticated_user", lambda: None)
    monkeypatch.setattr("app.rbac.get_supabase_client", lambda: None)
    monkeypatch.setattr(
        "app.venues.get_venue",
        lambda _: {**details(), "id": VENUE_ID, "revision": 1,
                   "setup_time_minutes": 0, "turnaround_time_minutes": 0},
    )
    saved = {**details(), "id": VENUE_ID, "revision": 2,
             "setup_time_minutes": 0, "turnaround_time_minutes": 45}
    monkeypatch.setattr("app.venues.update_venue", lambda *args: saved)
    # SCRUM-167: the save now notifies the affected coordinators; stub the lookup and send
    # so the report assertions stay focused on AC3 and no DB call escapes the test.
    monkeypatch.setattr(
        "app.venues.get_event_by_id", lambda event_id: {"id": event_id, "coordinator_id": 2}
    )
    monkeypatch.setattr("app.venues.create_notification", lambda *a, **k: None)
    client = app.test_client()
    select_user(client, 3)
    return client


def test_raising_a_buffer_reports_the_bookings_it_broke(editing_api, bookings):
    """AC3 end to end: the save succeeds, the bookings survive, the clash is surfaced."""
    bookings.extend([slot("a", 0, title="Science Fair"), slot("b", 2, title="Debate Final")])

    response = editing_api.put(
        f"/venues/{VENUE_ID}",
        json=editable_fields(turnaround_time_minutes=45),
        headers=ORIGIN,
    )

    assert response.status_code == 200
    assert response.json["venue"]["revision"] == 2, "the buffer change is saved"
    conflicts = response.json["buffer_conflicts"]
    assert {entry["event_title"] for entry in conflicts} == {"Science Fair", "Debate Final"}
    assert all(row["status"] in {"Confirmed", "Held"} for row in bookings), (
        "AC3: no booking is removed or rewritten to fit the new buffers"
    )


def test_a_save_that_leaves_the_buffers_alone_reports_nothing(editing_api, bookings, monkeypatch):
    """The report is only recomputed when the rule moved, so an ordinary edit is quiet."""
    bookings.extend([slot("a", 0), slot("b", 2)])
    monkeypatch.setattr(
        "app.venues.update_venue",
        lambda *args: {**details(), "id": VENUE_ID, "revision": 2,
                       "setup_time_minutes": 0, "turnaround_time_minutes": 0},
    )

    response = editing_api.put(
        f"/venues/{VENUE_ID}", json=editable_fields(capacity=120), headers=ORIGIN,
    )

    assert response.status_code == 200
    assert "buffer_conflicts" not in response.json
