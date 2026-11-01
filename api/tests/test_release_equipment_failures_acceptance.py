"""SCRUM-161: invalid reservations leave real stock and reservations unchanged."""
import os

import pytest

from .conftest import ORIGIN
from .test_equipment_acceptance import live_equipment as live_equipment
from .test_equipment_acceptance import unique_details

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"), reason="Disposable acceptance database required",
)


def test_invalid_reservations_do_not_consume_real_stock(request):
    db, users = request.getfixturevalue("live_equipment")
    created = users[4].post("/equipment", json=unique_details(), headers=ORIGIN)
    assert created.status_code == 201
    item = created.json["equipment"]
    path = f"/equipment/{item['id']}"
    valid = {"quantity": 1, "start_at": "2099-10-20T06:00:00Z", "end_at": "2099-10-20T07:00:00Z"}
    cases = [{**valid, "quantity": q} for q in (True, 1.5, "1", 0, -1)]
    cases += [{**valid, "start_at": value} for value in (None, {}, "invalid")]
    for body in cases:
        response = users[4].post(path + "/reservations", json=body, headers=ORIGIN)
        assert response.status_code == 400, response.json
        assert "reservation" not in response.json
    malformed_window = users[2].get(path + "/availability", headers=ORIGIN,
                                   query_string={**valid, "start_at": "invalid"})
    assert malformed_window.status_code == 400
    assert db.table("equipment_reservations").select("*").eq(
        "equipment_id", item["id"],
    ).execute().data == []
    assert db.table("equipment_items").select("total_quantity,usable_quantity").eq(
        "id", item["id"],
    ).execute().data == [{"total_quantity": 8, "usable_quantity": 8}]
    availability = users[2].get(path + "/availability", query_string=valid, headers=ORIGIN)
    assert availability.status_code == 200
    assert availability.json["availability"]["available_quantity"] == 8
