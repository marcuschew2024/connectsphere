"""Lazy, optional Supabase client for ConnectSphere.

Sprint 1 note: auth is a seeded-users stub. This module never raises at import
time or when credentials are absent, so the API runs without Supabase
configured. Callers should handle a ``None`` client gracefully.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from supabase import Client


@lru_cache(maxsize=1)
def get_supabase_client() -> Client | None:
    """Return a cached Supabase client, or ``None`` if not configured.

    Reads ``SUPABASE_URL`` and the backend ``SUPABASE_SECRET_KEY``. Falls back
    to ``SUPABASE_KEY`` for existing setups using a legacy service_role key.
    Missing credentials are supported, so this returns ``None`` in that case.
    """
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_KEY")

    if not url or not key:
        return None

    # Imported lazily so the dependency is only required when actually used.
    from supabase import create_client

    return create_client(url, key)


def is_supabase_configured() -> bool:
    """Return whether Supabase credentials are present in the environment."""
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_KEY")
    return bool(os.environ.get("SUPABASE_URL") and key)
