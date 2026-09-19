"""Tests for optional credentials and selection of the backend Supabase key."""

import sys
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.supabase_client import get_supabase_client, is_supabase_configured


@pytest.fixture(autouse=True)
def clear_credentials_and_cache(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    get_supabase_client.cache_clear()
    yield
    get_supabase_client.cache_clear()


def test_client_is_none_when_unconfigured():
    assert is_supabase_configured() is False
    assert get_supabase_client() is None


@pytest.mark.parametrize("keys", [
    {"SUPABASE_SECRET_KEY": "sb_secret_test_only"},
    {"SUPABASE_KEY": "legacy.service_role.key"},
    {"SUPABASE_SECRET_KEY": "sb_secret_test_only", "SUPABASE_KEY": "sb_publishable_test_only"},
    {"SUPABASE_SECRET_KEY": "", "SUPABASE_KEY": "legacy.service_role.key"},
])
def test_client_selects_backend_secret_before_legacy_fallback(monkeypatch, keys):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    for name, value in keys.items():
        monkeypatch.setenv(name, value)
    create_client = Mock()
    monkeypatch.setitem(sys.modules, "supabase", SimpleNamespace(create_client=create_client))

    assert is_supabase_configured() is True
    assert get_supabase_client() is create_client.return_value
    assert get_supabase_client() is create_client.return_value  # Reuses the cached client.
    expected_key = keys.get("SUPABASE_SECRET_KEY") or keys["SUPABASE_KEY"]
    create_client.assert_called_once_with("https://example.supabase.co", expected_key)


@pytest.mark.parametrize("variables", [
    {"SUPABASE_URL": "https://example.supabase.co"},
    {"SUPABASE_SECRET_KEY": "sb_secret_test_only"},
])
def test_partial_configuration_stays_optional(monkeypatch, variables):
    for name, value in variables.items():
        monkeypatch.setenv(name, value)
    assert is_supabase_configured() is False
    assert get_supabase_client() is None
