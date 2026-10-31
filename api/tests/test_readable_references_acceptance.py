"""A persistent display reference must not depend on list ordering or one writer."""
import os
from concurrent.futures import ThreadPoolExecutor

import pytest
from postgrest import SyncPostgrestClient
from postgrest.exceptions import APIError

pytestmark = pytest.mark.skipif(not os.environ.get("POSTGREST_TEST_URL"),
                                reason="Disposable acceptance database required")


def test_concurrent_references_survive_edits_and_refuse_reassignment():
    url = os.environ["POSTGREST_TEST_URL"]
    assert url in {"http://127.0.0.1:55433", "http://localhost:55433"}

    def create(number):
        with SyncPostgrestClient(url) as db:
            return db.table("events").insert({
                "title": f"Reference concurrency {number}", "organiser_id": 1, "status": "Draft",
            }).execute().data[0]

    rows = []
    try:
        with ThreadPoolExecutor(max_workers=8) as pool:
            rows = list(pool.map(create, range(16)))
        assert len({row["reference"] for row in rows}) == 16
        assert all(row["reference"].startswith("EVT-") for row in rows)
        with SyncPostgrestClient(url) as db:
            target = rows[0]
            edited = db.table("events").update({
                "title": "Renamed reference event", "event_datetime": "2099-11-01T08:00:00Z",
            }).eq("id", target["id"]).execute().data[0]
            assert edited["id"] == target["id"]
            assert edited["reference"] == target["reference"]
            with pytest.raises(APIError):
                db.table("events").update({"reference": "EVT-999999"}).eq(
                    "id", target["id"]).execute()
            saved = db.table("events").select("id,reference").eq(
                "id", target["id"]).execute().data[0]
            assert saved == {"id": target["id"], "reference": target["reference"]}
    finally:
        with SyncPostgrestClient(url) as db:
            for row in rows:
                db.table("events").delete().eq("id", row["id"]).execute()
