"""First-time setup must unblock signup without unlocking an established limit."""

import pytest

from app.registration_capacity import RegistrationCapacity

from . import test_registration_capacity
from .conftest import ORIGIN

EVENT_ID = test_registration_capacity.EVENT_ID
capacity_api = test_registration_capacity.capacity_api


@pytest.mark.parametrize(("status", "capacity", "count", "allowed"), [
    ("Draft", None, 0, True), ("Submitted", None, 0, True),
    ("Planning", 10, 0, True), ("Confirmed", None, 0, True),
    ("Confirmed", 10, 0, False), ("Confirmed", 10, 1, False),
    ("Confirmed", None, 1, False), ("Preparation", None, 0, False),
    ("Completed", None, 0, False), ("Cancelled", None, 0, False),
    ("Rejected", None, 0, False),
])
def test_only_an_unset_empty_confirmed_event_gets_the_setup_exception(
    status, capacity, count, allowed,
):
    assert RegistrationCapacity(capacity, count).can_set(status) is allowed


def test_owner_can_set_the_initial_confirmed_capacity_through_the_existing_api(capacity_api):
    client, event, calls = capacity_api
    event["status"] = "Confirmed"
    response = client.put(f"/events/{EVENT_ID}/registration-capacity",
                          json={"capacity": 72}, headers=ORIGIN)
    assert response.status_code == 200
    assert response.json["registration_capacity"]["capacity"] == 72
    assert calls == [(EVENT_ID, 1, 72)]


@pytest.mark.parametrize(("status", "capacity"), [
    ("Confirmed", 10), ("Preparation", None), ("Completed", None),
    ("Cancelled", None), ("Rejected", None),
])
def test_established_limits_and_other_lifecycle_states_remain_locked(
    capacity_api, status, capacity,
):
    client, event, calls = capacity_api
    event.update(status=status, registration_capacity=capacity)
    response = client.put(f"/events/{EVENT_ID}/registration-capacity",
                          json={"capacity": 72}, headers=ORIGIN)
    assert response.status_code == 409
    assert calls == []
