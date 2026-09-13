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

    Reads ``SUPABASE_URL`` and ``SUPABASE_KEY`` from the environment. Absence of
    either variable is a supported state during Sprint 1 (seeded-users stub),
    so this returns ``None`` instead of raising.
    """
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")

    if not url or not key:
        return None

    # Imported lazily so the dependency is only required when actually used.
    from supabase import create_client

    return create_client(url, key)


def is_supabase_configured() -> bool:
    """Return whether Supabase credentials are present in the environment."""
    return bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY"))
