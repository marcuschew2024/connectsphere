"""Equipment requests persist atomically; reads are scoped before pagination."""

from postgrest.exceptions import APIError
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from .supabase_client import get_supabase_client

PAGE_SIZE = 6
HISTORY_PAGE_SIZE = 20
READ_FIELDS = (
    "*,event:events!inner(id,reference,title,event_datetime,coordinator_id,status),"
    "requester:app_users!equipment_requests_requested_by_fkey(display_name),"
    "items:equipment_request_items(*),"
    # SCRUM-153: each reservation carries its item's current condition.
    "reservations:equipment_reservations!equipment_reservations_request_id_fkey("
    "*,equipment:equipment_items(operational_status))"
)


def _client():
    client = get_supabase_client()
    if client is None:
        raise ServiceUnavailable("The database is not configured. Contact the team.")
    return client


def _usable(reservation: dict) -> bool:
    """SCRUM-153 (SCRUM-63): units held on Damaged / Under Maintenance stock are not ready."""
    equipment = reservation.get("equipment") or {}
    return equipment.get("operational_status", "Operational") == "Operational"


def _summarize_reservations(row: dict) -> None:
    """Use real linked bookings, including releases from the event-cancel trigger."""
    held = [r for r in row.get("reservations", []) if r["status"] in {"Reserved", "Pending"}]
    active = {r["equipment_id"]: r["quantity"] for r in held if _usable(r)}
    unusable = {r["equipment_id"]: r["quantity"] for r in held if not _usable(r)}
    row["items"].sort(key=lambda item: item["position"])
    for item in row["items"]:
        item["reserved_quantity"] = active.get(item["equipment_id"], 0)
        # Still booked, but on stock that is currently unusable: shown, never counted.
        item["unusable_reserved_quantity"] = unusable.get(item["equipment_id"], 0)
    if row["items"] and all(i["reserved_quantity"] >= i["quantity"] for i in row["items"]):
        status = "Reserved"
    elif any(active.values()):
        status = "Partially fulfilled"
    else:
        status = "Unavailable" if row["status"] == "Unavailable" else "Requested"
    # Preserve old manually recorded labels in history; never invent a booking.
    if row["status"] != status:
        row["reported_status"] = row["status"]
    row["status"] = status


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
            _summarize_reservations(row)
        return rows[:PAGE_SIZE], len(rows) > PAGE_SIZE
    except Exception as error:
        raise ServiceUnavailable("Could not load equipment requests. Please try again.") from error


def list_confirmation_requests(event_id: str) -> list[dict]:
    """Read all requests for an authorised event, deriving readiness from current stock links.

    The caller has already checked Coordinator/event access. Do not paginate a gate:
    a later unresolved request must block just as an earlier one does.
    """
    try:
        rows = _client().table("equipment_requests").select(READ_FIELDS).eq(
            "event_id", event_id,
        ).execute().data
        for row in rows:
            # Pending, Released and Cancelled allocations are not fully reserved.
            row["reservations"] = [
                reservation for reservation in row["reservations"]
                if reservation["status"] == "Reserved"
            ]
            _summarize_reservations(row)
        return [{"id": row["id"], "status": row["status"]} for row in rows]
    except Exception as error:
        raise ServiceUnavailable(
            "Could not verify technical arrangements. Please try again."
        ) from error


def list_request_events(actor_id: int, page: int) -> tuple[list[dict], bool]:
    try:
        start = (page - 1) * PAGE_SIZE
        rows = (
            _client()
            .table("events")
            .select("id,reference,title,event_datetime")
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
        row = rows[0]
        _summarize_reservations(row)
        # Read candidates only after checking access to this request's event.
        row["existing_reservations"] = (
            _client()
            .table("equipment_reservations")
            .select("*")
            .eq("event_id", row["event_id"])
            .is_("request_id", "null")
            .in_("status", ["Reserved", "Pending"])
            .order("start_at")
            .execute()
            .data
        )
        return row
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
            _client()
            .table("equipment_request_history")
            .select("*,request:equipment_requests!inner(event:events!inner(coordinator_id))")
            .eq("request_id", request_id)
        )
        # Scope the history query itself, even if assignment changed after the detail read.
        if user["role"] == "Coordinator":
            query = query.eq("request.event.coordinator_id", user["id"])
        start = (page - 1) * HISTORY_PAGE_SIZE
        rows = (
            query.order("revision", desc=True)
            .range(start, start + HISTORY_PAGE_SIZE)
            .execute()
            .data
        )
        for row in rows:
            row.pop("request", None)
        return rows[:HISTORY_PAGE_SIZE], len(rows) > HISTORY_PAGE_SIZE
    except Exception as error:
        raise ServiceUnavailable("Could not load status history. Please try again.") from error


def update_request_status(
    request_id: str,
    status: str,
    notes: str,
    revision: int,
    actor_id: int,
) -> dict:
    return _write_request(
        "update_equipment_request_status",
        {
            "p_request_id": request_id,
            "p_status": status,
            "p_notes": notes,
            "p_revision": revision,
            "p_actor_id": actor_id,
        },
    )


def save_request_reservations(request_id: str, details: dict, actor_id: int) -> dict:
    return _write_request(
        "save_equipment_request_reservations",
        {
            "p_request_id": request_id,
            "p_actor_id": actor_id,
            **{"p_" + key: value for key, value in details.items()},
        },
    )


def _write_request(function: str, parameters: dict) -> dict:
    try:
        rows = _client().rpc(function, parameters).execute().data
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
                "insufficient_equipment": (
                    "Not enough available equipment for that time slot. "
                    "Reduce the reserved quantity or choose another slot."
                ),
                "booking_changed": (
                    "That existing booking no longer matches. "
                    "Reload the request before linking it."
                ),
                "linked_reservations": (
                    "Release the linked units before marking this request "
                    "Requested or Unavailable."
                ),
                "stale_request": "Someone else updated this request. Reload it before saving.",
                "unchanged_status": "Choose a different status to record an update.",
                "closed_event": (
                    "Requests for cancelled, completed or rejected events are read-only."
                ),
            }
            raise Conflict(
                messages.get(
                    error.message, "This request cannot be updated. Reload it before trying again."
                )
            ) from error
        if error.code in {"22023", "22P02", "22003", "23514"}:
            raise BadRequest(
                "Check the quantities, time slot, status and notes, then try again."
            ) from error
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
