"""Persistence for the shared venue catalogue (SCRUM-24)."""

from postgrest.exceptions import APIError
from werkzeug.exceptions import Conflict, Forbidden, NotFound, ServiceUnavailable

from .supabase_client import get_supabase_client

PAGE_SIZE = 6


def _client():
    client = get_supabase_client()
    if client is None:
        raise ServiceUnavailable("The database is not configured. Contact the team.")
    return client


def create_venue(fields: dict, actor_id: int) -> dict:
    try:
        # created_at comes from PostgreSQL; the caller cannot supply audit fields.
        result = _client().table("venues").insert({**fields, "created_by": actor_id}).execute()
        if not result.data:
            raise ServiceUnavailable(
                "Could not confirm the venue was saved. Check the catalogue before retrying."
            )
        return result.data[0]
    except APIError as error:
        if error.code == "23505":
            raise Conflict("A venue with this name and location already exists.") from error
        raise ServiceUnavailable(
            "Could not confirm the venue was saved. Check the catalogue before retrying."
        ) from error
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not confirm the venue was saved. Check the catalogue before retrying."
        ) from error


def list_venues(page: int) -> tuple[list[dict], bool]:
    try:
        start = (page - 1) * PAGE_SIZE
        rows = _client().table("venues").select(
            "*,creator:app_users(display_name)"
        ).order("created_at", desc=True).order("id").range(start, start + PAGE_SIZE).execute().data
        return rows[:PAGE_SIZE], len(rows) > PAGE_SIZE
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not load the venue catalogue. Please try again.") from error


def get_venue(venue_id: str) -> dict | None:
    try:
        result = _client().table("venues").select("*").eq("id", venue_id).execute()
        return result.data[0] if result.data else None
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable("Could not load the selected venue. Contact the team.") from error


def update_venue(venue_id: str, fields: dict, actor_id: int, revision: int) -> dict:
    """The database saves the changes and audit record in one transaction."""
    try:
        result = (
            _client()
            .rpc(
                "update_venue_details",
                {
                    "p_venue_id": venue_id,
                    "p_details": fields,
                    "p_actor_id": actor_id,
                    "p_revision": revision,
                },
            )
            .execute()
        )
        if not result.data:
            raise ServiceUnavailable(
                "Could not confirm the update. Reload the venue before retrying."
            )
        return result.data[0]
    except APIError as error:
        if error.code == "PT409":
            raise Conflict(
                "Another staff member updated this venue. Reload it and reapply your changes."
            ) from error
        if error.code == "PT404":
            raise NotFound("Venue not found.") from error
        if error.code == "PT403":
            raise Forbidden("Only Venue Staff can update a venue.") from error
        raise ServiceUnavailable(
            "Could not confirm the update. Reload the venue before retrying."
        ) from error
    except ServiceUnavailable:
        raise
    except Exception as error:
        raise ServiceUnavailable(
            "Could not confirm the update. Reload the venue before retrying."
        ) from error
