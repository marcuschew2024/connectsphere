"""SCRUM-153 (SCRUM-63): units reserved on unusable stock never count as reserved."""

import pytest

from app.equipment_request_repository import _summarize_reservations


def request(reservations, *, quantity=2, status="Reserved"):
    return {
        "status": status,
        "items": [{"equipment_id": "mic", "quantity": quantity, "position": 1}],
        "reservations": reservations,
    }


def booking(quantity, condition="Operational", status="Reserved"):
    return {"equipment_id": "mic", "quantity": quantity, "status": status,
            "equipment": {"operational_status": condition}}


def test_operational_reservation_is_ready():
    row = request([booking(2)])
    _summarize_reservations(row)
    assert row["status"] == "Reserved"
    assert row["items"][0]["reserved_quantity"] == 2
    assert row["items"][0]["unusable_reserved_quantity"] == 0


@pytest.mark.parametrize("condition", ["Damaged", "Under Maintenance"])
def test_reservation_on_unusable_stock_is_not_ready(condition):
    row = request([booking(2, condition)])
    _summarize_reservations(row)
    # The stored label said Reserved; readiness now reflects the stock's condition.
    assert row["status"] == "Requested"
    assert row["reported_status"] == "Reserved"
    assert row["items"][0]["reserved_quantity"] == 0
    assert row["items"][0]["unusable_reserved_quantity"] == 2


def test_partly_unusable_reservation_is_partially_fulfilled():
    row = {
        "status": "Reserved",
        "items": [
            {"equipment_id": "mic", "quantity": 1, "position": 1},
            {"equipment_id": "cam", "quantity": 1, "position": 2},
        ],
        "reservations": [
            booking(1),
            {"equipment_id": "cam", "quantity": 1, "status": "Reserved",
             "equipment": {"operational_status": "Damaged"}},
        ],
    }
    _summarize_reservations(row)
    assert row["status"] == "Partially fulfilled"
    assert [i["unusable_reserved_quantity"] for i in row["items"]] == [0, 1]


def test_rows_without_condition_keep_the_previous_behaviour():
    # Older callers and fixtures that do not embed the item's condition are unchanged.
    row = request([{"equipment_id": "mic", "quantity": 2, "status": "Reserved"}])
    _summarize_reservations(row)
    assert row["status"] == "Reserved"
