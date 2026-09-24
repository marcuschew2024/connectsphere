"""Persistence for the shared venue catalogue (SCRUM-24)."""

from postgrest.exceptions import APIError
from werkzeug.exceptions import Conflict, ServiceUnavailable

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
