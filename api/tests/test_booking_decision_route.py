"""SCRUM-32/121 decision-route tests with a fake Supabase client.

Against the real SCRUM-31 schema: the awaiting-decision status is 'Requested' (legacy
'Pending' also accepted). The fake simulates the venue_bookings EXCLUDE overlap constraint
so the conflict/boundary cases are covered without a database. Live-DB acceptance versions
live in test_booking_acceptance.py.
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from .conftest import ORIGIN, select_user

SLOT_2_4PM = ("2099-10-20T06:00:00Z", "2099-10-20T08:00:00Z")
SLOT_4_6PM = ("2099-10-20T08:00:00Z", "2099-10-20T10:00:00Z")  # touches 2-4pm
SLOT_3_5PM = ("2099-10-20T07:00:00Z", "2099-10-20T09:00:00Z")  # overlaps 2-4pm
VENUE_A = "33333333-3333-4333-8333-333333333333"


class FakeApiError(Exception):
    """Mimics a PostgREST error carrying a Postgres SQLSTATE code."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _overlaps(a, b):
    return a["start_at"] < b["end_at"] and b["start_at"] < a["end_at"]


@pytest.fixture
def booking_db(monkeypatch):
    rows: list[dict] = []
    notifications: list[dict] = []
    client = MagicMock()

    def table(name):
        assert name in {"venue_bookings", "notifications"}
        q = MagicMock()
        eqs: dict = {}
        ins: dict = {}
        op = "select"
        pend_ins = None
        pend_upd = None

        def _eq(col, val):
            eqs[col] = val
            return q

        def _in(col, vals):
            ins[col] = list(vals)
            return q

        def _match(r):
            return (all(r.get(k) == v for k, v in eqs.items())
                    and all(r.get(k) in v for k, v in ins.items()))

        def execute():
            if op == "insert" and name == "notifications":
                row = {
                    **pend_ins, "id": len(notifications) + 1,
                    "created_at": datetime.now(UTC).isoformat(),
                }
                notifications.append(row)
                return SimpleNamespace(data=[row])
            if op == "update":
                matching = [r for r in rows if _match(r)]
                if pend_upd.get("status") == "Confirmed":
                    for r in matching:
                        for other in rows:
                            if other is r or other.get("status") not in ("Confirmed", "Blocked"):
                                continue
                            if other["venue_id"] == r["venue_id"] and _overlaps(other, r):
                                raise FakeApiError("23P01")
                for r in matching:
                    r.update(pend_upd)
                return SimpleNamespace(data=matching)
            src = notifications if name == "notifications" else rows
            return SimpleNamespace(data=[r for r in src if _match(r)])

        def insert(f):
            nonlocal op, pend_ins
            op, pend_ins = "insert", f
            return q

        def update(f):
            nonlocal op, pend_upd
            op, pend_upd = "update", f
            return q

        q.select.return_value = q
        q.eq.side_effect = _eq
        q.in_.side_effect = _in
        q.order.return_value = q
        q.limit.return_value = q
        q.insert.side_effect = insert
        q.update.side_effect = update
        q.execute.side_effect = execute
        return q

    client.table.side_effect = table
    client.rows = rows
    client.notifications = notifications
    monkeypatch.setattr("app.booking_repository.get_supabase_client", lambda: client)
    monkeypatch.setattr("app.event_repository.get_supabase_client", lambda: client)
    return client


def seed(client, *, status="Requested", slot=SLOT_2_4PM, venue_id=VENUE_A, requested_by=2):
    row = {
        "id": str(uuid4()), "event_id": str(uuid4()), "venue_id": venue_id,
        "start_at": slot[0], "end_at": slot[1], "status": status,
        "decision_reason": None, "suggested_alternative": None,
        "decided_by": None, "decision_at": None, "requested_by": requested_by,
        "requested_at": datetime.now(UTC).isoformat(),
        "venue": {"name": "Auditorium A", "location": "L3"}, "event": {"title": "Workshop"},
    }
    client.rows.append(row)
    return row


@pytest.fixture
def venue_staff(app):
    c = app.test_client()
    assert select_user(c, 3).status_code == 200  # id 3 == Venue Staff
    return c


@pytest.fixture
def coordinator(app):
    c = app.test_client()
    assert select_user(c, 2).status_code == 200  # id 2 == Coordinator
    return c


def decide(client, bid, decision, **body):
    return client.post(
        f"/venues/bookings/{bid}/decision",
        json={"decision": decision, **body}, headers=ORIGIN,
    )


def test_approve_confirms_and_notifies(venue_staff, booking_db):
    b = seed(booking_db)
    r = decide(venue_staff, b["id"], "approve")
    assert r.status_code == 200
    assert r.json["booking"]["status"] == "Confirmed"
    assert r.json["booking"]["decided_by"] == 3 and r.json["booking"]["decision_at"]
    assert [n["notification_type"] for n in booking_db.notifications] == ["booking_approved"]
    assert booking_db.notifications[0]["recipient_id"] == b["requested_by"]


def test_reject_requires_reason(venue_staff, booking_db):
    b = seed(booking_db)
    assert decide(venue_staff, b["id"], "reject").status_code == 400
    assert b["status"] == "Requested" and booking_db.notifications == []


def test_reject_stores_reason_alternative_and_notifies(venue_staff, booking_db):
    b = seed(booking_db)
    r = decide(venue_staff, b["id"], "reject", reason="Double-booked.", alternative="Room B, 4-6pm")
    assert r.status_code == 200
    assert r.json["booking"]["status"] == "Rejected"
    assert r.json["booking"]["decision_reason"] == "Double-booked."
    assert r.json["booking"]["suggested_alternative"] == "Room B, 4-6pm"
    assert booking_db.notifications[0]["notification_type"] == "booking_rejected"
    assert "Room B, 4-6pm" in booking_db.notifications[0]["message"]


def test_non_staff_cannot_decide(coordinator, booking_db):
    b = seed(booking_db)
    assert decide(coordinator, b["id"], "approve").status_code == 403
    assert b["status"] == "Requested"


def test_missing_booking_is_404(venue_staff, booking_db):
    assert decide(venue_staff, str(uuid4()), "approve").status_code == 404


def test_second_decision_conflicts(venue_staff, booking_db):
    b = seed(booking_db, status="Confirmed")
    assert decide(venue_staff, b["id"], "reject", reason="nope").status_code == 409
    assert b["status"] == "Confirmed"


def test_overlapping_approve_conflicts(venue_staff, booking_db):
    seed(booking_db, status="Confirmed", slot=SLOT_2_4PM)
    p = seed(booking_db, status="Requested", slot=SLOT_3_5PM)
    assert decide(venue_staff, p["id"], "approve").status_code == 409
    assert p["status"] == "Requested"


def test_adjacent_touching_approve_allowed(venue_staff, booking_db):
    seed(booking_db, status="Confirmed", slot=SLOT_2_4PM)
    p = seed(booking_db, status="Requested", slot=SLOT_4_6PM)
    assert decide(venue_staff, p["id"], "approve").status_code == 200
    assert p["status"] == "Confirmed"
