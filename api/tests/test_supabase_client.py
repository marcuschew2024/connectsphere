"""Tests for the optional Supabase client."""

from app.supabase_client import get_supabase_client, is_supabase_configured


def test_client_is_none_when_unconfigured(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_KEY", raising=False)
    get_supabase_client.cache_clear()

    assert is_supabase_configured() is False
    assert get_supabase_client() is None
