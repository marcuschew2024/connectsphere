"""The database queries for our temporary demo users."""

from werkzeug.exceptions import ServiceUnavailable

from .supabase_client import get_supabase_client


def list_demo_users(user_id: int | None = None) -> list[dict]:
    """Read demo users, optionally selecting just one ID. Never return real users."""
    try:
        client = get_supabase_client()
        if client is None:
            raise ServiceUnavailable("Set SUPABASE_URL and SUPABASE_SECRET_KEY in api/.env first.")

        query = client.table("app_users").select("id,display_name,role").eq("is_demo", True)
        if user_id is not None:
            query = query.eq("id", user_id)
        return query.order("id").execute().data
    except ServiceUnavailable:
        raise
    except Exception as error:
        # Keep database details and credentials out of HTTP error responses.
        raise ServiceUnavailable(
            "Cannot read demo users. Check Supabase, SUPABASE_SECRET_KEY (a backend secret key), "
            "and that supabase/seed_users.sql has been run."
        ) from error


def get_demo_user(user_id: object) -> dict | None:
    """Return an existing demo user, or None for an invalid/unknown ID."""
    # Require a JSON integer. In Python, bool is an int subclass, so reject it explicitly.
    if type(user_id) is not int or not 1 <= user_id <= 2_147_483_647:
        return None

    users = list_demo_users(user_id)
    return users[0] if users else None
