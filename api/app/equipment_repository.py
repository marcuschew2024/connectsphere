"""Catalogue persistence. A database function saves stock and history atomically."""

from postgrest.exceptions import APIError
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from .supabase_client import get_supabase_client

PAGE_SIZE = 6
READ_FIELDS = (
    "*,creator:app_users!equipment_items_created_by_fkey(display_name),"
    "editor:app_users!equipment_items_updated_by_fkey(display_name)"
)


def _client():
    client = get_supabase_client()
    if client is None:
        raise ServiceUnavailable("The database is not configured. Contact the team.")
    return client


def list_equipment(page: int, operational_only: bool = False) -> tuple[list[dict], bool]:
    try:
        query = _client().table("equipment_items").select(READ_FIELDS)
        if operational_only:
            query = query.gt("usable_quantity", 0)
        start = (page - 1) * PAGE_SIZE
        rows = (
            query.order("created_at", desc=True)
            .order("id")
            .range(start, start + PAGE_SIZE)
            .execute()
            .data
        )
        return rows[:PAGE_SIZE], len(rows) > PAGE_SIZE
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not load the equipment catalogue. Please try again."
        ) from error


def get_equipment(equipment_id: str) -> dict | None:
    try:
        rows = (
            _client()
            .table("equipment_items")
            .select(READ_FIELDS)
            .eq("id", equipment_id)
            .execute()
            .data
        )
        return rows[0] if rows else None
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not load this equipment. Please try again.") from error


def save_equipment(
    fields: dict, actor_id: int, equipment_id: str | None = None, revision: int | None = None
) -> dict:
    try:
        rows = (
            _client()
            .rpc(
                "save_equipment_item",
                {
                    "p_details": fields,
                    "p_actor_id": actor_id,
                    "p_equipment_id": equipment_id,
                    "p_revision": revision,
                },
            )
            .execute()
            .data
        )
        if not rows:
            raise ServiceUnavailable(
                "Could not confirm the save. Check the catalogue before retrying."
            )
        return rows[0]
    except APIError as error:
        if error.code == "PT409":
            raise Conflict(
                "Another staff member updated this equipment. Reload it and reapply your changes."
            ) from error
        if error.code == "PT404":
            raise NotFound("Equipment not found.") from error
        if error.code == "PT403":
            raise Forbidden("Only Tech Support can maintain equipment.") from error
        if error.code in {"22023", "23514"}:
            raise BadRequest("Check the equipment details and try again.") from error
        raise ServiceUnavailable(
            "Could not confirm the save. Check the catalogue before retrying."
        ) from error
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not confirm the save. Check the catalogue before retrying."
        ) from error
