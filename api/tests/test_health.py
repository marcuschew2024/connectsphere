"""Tests for the /health endpoint."""

from app import create_app


def test_health_returns_ok():
    # APP_ENV defaults to production, which now requires a signing key (SCRUM-142).
    app = create_app({"TESTING": True, "SECRET_KEY": "test-only-secret"})
    client = app.test_client()

    response = client.get("/health")

    assert response.status_code == 200
    assert response.get_json() == {"status": "ok"}
