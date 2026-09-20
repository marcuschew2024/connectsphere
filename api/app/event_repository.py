"""Supabase queries for events. HTTP and validation belong in events.py."""

from werkzeug.exceptions import ServiceUnavailable

from .supabase_client import get_supabase_client


def insert_event(fields: dict) -> dict:
    """Insert one event and return its stored ID, details and database timestamps."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("The database is not configured. Contact the team.")
        result = client.table("events").insert(fields).execute()
        if not result.data:
            raise ServiceUnavailable("The database did not confirm the saved request.")
        return result.data[0]
    except ServiceUnavailable:
        raise
    except Exception as error:
        # Never expose Supabase credentials or internal database details to the browser.
        raise ServiceUnavailable(
            "Could not confirm that the request was saved. Contact the team before retrying."
        ) from error
