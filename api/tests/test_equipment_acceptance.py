"""Real Flask → PostgREST → PostgreSQL checks for SCRUM-34, with disposable data."""

import importlib
import os
from uuid import uuid4

import pytest
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError

from app import create_app

from .conftest import ORIGIN, select_user
from .test_equipment import details

pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGREST_TEST_URL"),
    reason="Disposable acceptance services are not running",
)


@pytest.fixture
def live_equipment(monkeypatch):
    assert os.environ["POSTGREST_TEST_URL"] in (
        "http://127.0.0.1:55433",
        "http://localhost:55433",
    ), "Equipment acceptance tests only run against the disposable local stack."
    with SyncPostgrestClient(os.environ["POSTGREST_TEST_URL"]) as db:
        for name in ("users", "equipment_repository", "rbac", "auth"):
            monkeypatch.setattr(
                importlib.import_module(f"app.{name}"), "get_supabase_client", lambda: db
            )
        app = create_app(
            {
                "TESTING": True,
                "APP_ENV": "development",
                "DEV_ROLE_SWITCHER_ENABLED": True,
                "SECRET_KEY": "acceptance-test-only",
                "FRONTEND_ORIGIN": ORIGIN["Origin"],
            }
        )
        users = {number: app.test_client() for number in range(1, 6)}
        for number, client in users.items():
            assert select_user(client, number).status_code == 200
        try:
            yield db, users
        finally:
            db.table("equipment_items").delete().ilike(
                "equipment_type", "Equipment acceptance %"
            ).execute()


def unique_details(**overrides):
    return {**details(), "equipment_type": f"Equipment acceptance {uuid4()}", **overrides}


def test_create_edit_audit_and_stale_edit_protection(live_equipment):
    db, users = live_equipment
    values = unique_details()
    response = users[4].post("/equipment", json=values, headers=ORIGIN)
    assert response.status_code == 201, response.json
    original = response.json["equipment"]
    assert all(original[field] == value for field, value in values.items())
    assert original["usable_quantity"] == 8
    assert original["created_by"] == original["updated_by"] == 4
    assert original["created_at"] == original["updated_at"]
    assert original["revision"] == 1
    catalogue = users[2].get("/equipment", headers=ORIGIN).json["equipment"]
    assert next(row for row in catalogue if row["id"] == original["id"])["editor"] == {
        "display_name": "Demo Tech Support",
    }
    changes = {
        **values,
        "total_quantity": 6,
        "description": "Receiver needs repair",
        "location": "Repair bench",
        "operational_status": "Damaged",
        "revision": 1,
    }
    edited = users[4].put(f"/equipment/{original['id']}", json=changes, headers=ORIGIN)
    assert edited.status_code == 200, edited.json
    saved = edited.json["equipment"]
    assert saved["usable_quantity"] == 0 and saved["revision"] == 2
    assert saved["created_at"] == original["created_at"]
    assert saved["updated_at"] >= original["updated_at"]
    history = (
        db.table("equipment_item_history")
        .select("*")
        .eq("equipment_id", saved["id"])
        .order("changed_at")
        .execute()
        .data
    )
    assert [row["action"] for row in history] == ["Created", "Updated"]
    assert history[0]["before_details"] is None
    assert history[0]["after_details"] == original
    assert history[1]["before_details"] == original
    assert history[1]["after_details"] == saved
    assert history[1]["actor_id"] == 4 and history[1]["changed_at"] == saved["updated_at"]
    stale = users[4].put(f"/equipment/{saved['id']}", json=changes, headers=ORIGIN)
    assert stale.status_code == 409
    assert db.table("equipment_items").select("*").eq("id", saved["id"]).execute().data == [saved]
    assert (
        db.table("equipment_item_history")
        .select("*")
        .eq("equipment_id", saved["id"])
        .order("changed_at")
        .execute()
        .data
        == history
    )


def test_condition_and_zero_stock_excluded_before_pagination(live_equipment):
    _, users = live_equipment
    usable = []
    for index in range(10):
        status = "Operational" if index < 7 else ("Damaged" if index == 7 else "Under Maintenance")
        quantity = 0 if index == 9 else 3
        response = users[4].post(
            "/equipment",
            json=unique_details(
                operational_status=status,
                total_quantity=quantity,
            ),
            headers=ORIGIN,
        )
        assert response.status_code == 201
        item = response.json["equipment"]
        assert item["usable_quantity"] == (quantity if status == "Operational" else 0)
        if item["usable_quantity"]:
            usable.append(item["id"])
    # Include an operational zero-stock entry as well.
    assert (
        users[4]
        .post("/equipment", json=unique_details(total_quantity=0), headers=ORIGIN)
        .status_code
        == 201
    )
    first = users[2].get("/equipment?operational_only=true", headers=ORIGIN).json
    second = users[2].get("/equipment?operational_only=true&page=2", headers=ORIGIN).json
    assert first["has_more"] is True and second["has_more"] is False
    assert [row["id"] for row in first["equipment"] + second["equipment"]] == list(reversed(usable))


@pytest.mark.parametrize(
    "field,value,code",
    [
        ("total_quantity", -1, "22023"),
        ("total_quantity", 1.5, "22023"),
        ("total_quantity", True, "22023"),
        ("total_quantity", "8", "22023"),
        ("total_quantity", 2147483648, "22023"),
        ("equipment_type", " ", "23514"),
        ("operational_status", "Available", "23514"),
        ("description", [], "22023"),
    ],
)
def test_database_validates_without_api_and_failed_save_has_no_audit(
    live_equipment, field, value, code
):
    db, users = live_equipment
    original = users[4].post("/equipment", json=unique_details(), headers=ORIGIN).json["equipment"]
    values = {key: original[key] for key in details()}
    with pytest.raises(APIError) as caught:
        db.rpc(
            "save_equipment_item",
            {
                "p_details": {**values, field: value},
                "p_actor_id": 4,
                "p_equipment_id": original["id"],
                "p_revision": 1,
            },
        ).execute()
    assert caught.value.code == code
    assert db.table("equipment_items").select("*").eq("id", original["id"]).execute().data == [
        original
    ]
    assert (
        len(
            db.table("equipment_item_history")
            .select("*")
            .eq("equipment_id", original["id"])
            .execute()
            .data
        )
        == 1
    )


def test_database_and_api_reject_non_support_writers(live_equipment):
    db, users = live_equipment
    for actor in (1, 2, 3, 5):
        assert (
            users[actor].post("/equipment", json=unique_details(), headers=ORIGIN).status_code
            == 403
        )
        with pytest.raises(APIError) as caught:
            db.rpc(
                "save_equipment_item", {"p_details": unique_details(), "p_actor_id": actor}
            ).execute()
        assert caught.value.code == "PT403"
