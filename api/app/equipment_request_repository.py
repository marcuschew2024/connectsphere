"""Equipment requests persist atomically; reads are scoped before pagination."""

from postgrest.exceptions import APIError
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from .supabase_client import get_supabase_client

PAGE_SIZE = 6
HISTORY_PAGE_SIZE = 20
READ_FIELDS = (
    "*,event:events!inner(id,title,event_datetime,coordinator_id,status),"
    "requester:app_users!equipment_requests_requested_by_fkey(display_name),"
    "items:equipment_request_items(*)"
)


def _client():
    client = get_supabase_client()
    if client is None:
        raise ServiceUnavailable("The database is not configured. Contact the team.")
    return client


def list_requests(user: dict, page: int) -> tuple[list[dict], bool]:
    try:
        query = _client().table("equipment_requests").select(READ_FIELDS)
        if user["role"] == "Coordinator":
            query = query.eq("event.coordinator_id", user["id"])
        start = (page - 1) * PAGE_SIZE
        rows = (
            query.order("requested_at", desc=True)
            .order("id")
            .range(start, start + PAGE_SIZE)
            .execute()
            .data
        )
        for row in rows:
            row["items"].sort(key=lambda item: item["position"])
        return rows[:PAGE_SIZE], len(rows) > PAGE_SIZE
    except Exception as error:
        raise ServiceUnavailable("Could not load equipment requests. Please try again.") from error


def list_request_events(actor_id: int, page: int) -> tuple[list[dict], bool]:
    try:
        start = (page - 1) * PAGE_SIZE
        rows = (
            _client()
            .table("events")
            .select("id,title,event_datetime")
            .eq("coordinator_id", actor_id)
            .eq("status", "Planning")
            .order("event_datetime")
            .order("id")
            .range(start, start + PAGE_SIZE)
            .execute()
            .data
        )
        return rows[:PAGE_SIZE], len(rows) > PAGE_SIZE
    except Exception as error:
        raise ServiceUnavailable(
            "Could not load your Planning events. Please try again."
        ) from error


def get_request(request_id: str, user: dict) -> dict:
    try:
        query = _client().table("equipment_requests").select(READ_FIELDS).eq("id", request_id)
        if user["role"] == "Coordinator":
            query = query.eq("event.coordinator_id", user["id"])
        rows = query.limit(1).execute().data
        if not rows:
            raise NotFound("Equipment request not found.")
        rows[0]["items"].sort(key=lambda item: item["position"])
        return rows[0]
    except NotFound:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not load the equipment request. Please try again."
        ) from error


def list_request_history(request_id: str, user: dict, page: int) -> tuple[list[dict], bool]:
    get_request(request_id, user)
    try:
        query = (
            _client().table("equipment_request_history")
            .select("*,request:equipment_requests!inner(event:events!inner(coordinator_id))")
            .eq("request_id", request_id)
        )
        # Scope the history query itself, even if assignment changed after the detail read.
        if user["role"] == "Coordinator":
            query = query.eq("request.event.coordinator_id", user["id"])
        start = (page - 1) * HISTORY_PAGE_SIZE
        rows = (
            query.order("revision", desc=True)
            .range(start, start + HISTORY_PAGE_SIZE).execute().data
        )
        for row in rows:
            row.pop("request", None)
        return rows[:HISTORY_PAGE_SIZE], len(rows) > HISTORY_PAGE_SIZE
    except Exception as error:
        raise ServiceUnavailable("Could not load status history. Please try again.") from error


def update_request_status(
    request_id: str, status: str, notes: str, revision: int, actor_id: int,
) -> dict:
    try:
        rows = _client().rpc("update_equipment_request_status", {
            "p_request_id": request_id, "p_status": status, "p_notes": notes,
            "p_revision": revision, "p_actor_id": actor_id,
        }).execute().data
        if not rows:
            raise ServiceUnavailable(
                "Could not confirm the update. Reload the request before retrying."
            )
        return rows[0]
    except APIError as error:
        if error.code == "PT403":
            raise Forbidden("Only Tech Support can update equipment request status.") from error
        if error.code == "PT404":
            raise NotFound("Equipment request not found.") from error
        if error.code == "PT409":
            messages = {
                "stale_request": "Someone else updated this request. Reload it before saving.",
                "unchanged_status": "Choose a different status to record an update.",
                "closed_event": (
                    "Requests for cancelled, completed or rejected events are read-only."
                ),
            }
            raise Conflict(messages.get(
                error.message, "This request cannot be updated. Reload it before trying again."
            )) from error
        if error.code in {"22023", "22P02", "23514"}:
            raise BadRequest("Check the status and update notes, then try again.") from error
        raise ServiceUnavailable(
            "Could not confirm the update. Reload the request before retrying."
        ) from error
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not confirm the update. Reload the request before retrying."
        ) from error


def record_request(event_id: str, items: list[dict], actor_id: int) -> dict:
    try:
        rows = (
            _client()
            .rpc(
                "record_equipment_request",
                {
                    "p_event_id": event_id,
                    "p_items": items,
                    "p_actor_id": actor_id,
                },
            )
            .execute()
            .data
        )
        if not rows:
            raise ServiceUnavailable(
                "Could not confirm submission. Check requests before retrying."
            )
        return rows[0]
    except APIError as error:
        if error.code == "PT403":
            raise Forbidden(
                "Only the event's assigned Coordinator can request equipment."
            ) from error
        if error.code == "PT409":
            raise Conflict("Equipment can only be requested for an event in Planning.") from error
        if error.code in {"22023", "22P02", "23503", "23514", "23505", "PT404"}:
            raise BadRequest(
                "Check the event, equipment and quantities, then try again."
            ) from error
        raise ServiceUnavailable(
            "Could not confirm submission. Check requests before retrying."
        ) from error
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not confirm submission. Check requests before retrying."
        ) from error
