"""SCRUM-167: a buffer change notifies the coordinators of now-conflicting bookings.

Covers the notification wiring on top of SCRUM-129's detection. The report shape is the
contract from `venue_buffer_conflicts.summarise`: top-level entries each carry a
`conflicts_with` list, and every slot carries `event_id` / `event_title` but not the
coordinator (resolved per event here). Mirrors the dedupe guarantee of block_venue.
"""

import app.venues as venues


def _slot(booking_id, event_id, title):
    return {"booking_id": booking_id, "event_id": event_id, "event_title": title}


def _patch(monkeypatch, coordinators):
    """coordinators: {event_id: coordinator_id or None}. Returns the captured notifications."""
    monkeypatch.setattr(
        "app.venues.get_event_by_id",
        lambda event_id: (
            {"id": event_id, "coordinator_id": coordinators.get(event_id)}
            if event_id in coordinators else None
        ),
    )
    sent = []
    monkeypatch.setattr(
        "app.venues.create_notification",
        lambda recipient, event, kind, message, **kw: sent.append(
            {"recipient": recipient, "event": event, "kind": kind, "message": message}
        ),
    )
    return sent


def test_each_affected_coordinator_is_notified_once(monkeypatch):
    # Two bookings made conflicting by the buffer change, owned by the same coordinator.
    report = [{
        **_slot("b1", "e1", "Launch"),
        "reason": "buffer_overlap",
        "conflicts_with": [_slot("b2", "e2", "Workshop")],
    }]
    sent = _patch(monkeypatch, {"e1": 2, "e2": 2})

    venues._notify_affected_coordinators({"name": "Hall A"}, report)

    assert len(sent) == 1
    assert sent[0]["recipient"] == 2
    assert sent[0]["kind"] == "venue_buffer_conflict"
    assert sent[0]["event"] == "e1"
    assert "Hall A" in sent[0]["message"]


def test_distinct_coordinators_each_get_their_own_notice(monkeypatch):
    report = [{
        **_slot("b1", "e1", "Launch"),
        "reason": "buffer_overlap",
        "conflicts_with": [_slot("b2", "e2", "Workshop")],
    }]
    sent = _patch(monkeypatch, {"e1": 2, "e2": 7})

    venues._notify_affected_coordinators({"name": "Hall A"}, report)

    assert {n["recipient"] for n in sent} == {2, 7}
    assert all(n["kind"] == "venue_buffer_conflict" for n in sent)


def test_booking_without_a_coordinator_is_skipped(monkeypatch):
    report = [{**_slot("b1", "e1", "Launch"), "reason": "buffer_overlap", "conflicts_with": []}]
    sent = _patch(monkeypatch, {"e1": None})

    venues._notify_affected_coordinators({"name": "Hall A"}, report)

    assert sent == []
