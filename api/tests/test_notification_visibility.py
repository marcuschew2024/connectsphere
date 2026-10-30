"""Unit tests for the notification recipient rule (SCRUM-49 / R07).

Pure domain-logic tests -- no database, no Flask. They encode the hybrid
recipient model from Decision Log (R07): a notification targets exactly one of
a specific user (recipient_id) or an unassigned role pool (recipient_role), and
a user may see it only when their id or role matches. Each test is written to
fail for a plausible wrong implementation (e.g. leaking across users or pools).
"""

import pytest

from app.notification_visibility import POOL_ROLES, can_see, recipient_fields

# --- can_see: user-targeted notifications are private to that exact user ---

def test_user_notification_visible_to_that_user():
    note = {"recipient_id": 7, "recipient_role": None}
    assert can_see(note, user_id=7, user_role="Organiser") is True


def test_user_notification_hidden_from_other_users():
    note = {"recipient_id": 7, "recipient_role": None}
    # A different user with any role must not see someone else's personal note.
    assert can_see(note, user_id=8, user_role="Organiser") is False


# --- can_see: role-pool notifications are visible to everyone holding the role ---

def test_pool_notification_visible_to_that_role():
    note = {"recipient_id": None, "recipient_role": "Venue Staff"}
    assert can_see(note, user_id=3, user_role="Venue Staff") is True


def test_pool_notification_hidden_from_other_roles():
    note = {"recipient_id": None, "recipient_role": "Venue Staff"}
    # Tech Support must not see the Venue Staff pool, and vice versa.
    assert can_see(note, user_id=4, user_role="Tech Support") is False


def test_pool_notification_hidden_from_attendee():
    # Attendees never see internal planning content addressed to a staff pool.
    note = {"recipient_id": None, "recipient_role": "Tech Support"}
    assert can_see(note, user_id=5, user_role="Attendee") is False


# --- can_see: a row targeting neither is malformed and never surfaces ---

def test_malformed_notification_is_never_visible():
    note = {"recipient_id": None, "recipient_role": None}
    assert can_see(note, user_id=1, user_role="Organiser") is False


# --- recipient_fields: exactly one target, pool role must be recognised ---

def test_recipient_fields_accepts_a_specific_user():
    assert recipient_fields(recipient_id=7) == {"recipient_id": 7}


def test_recipient_fields_accepts_a_pool_role():
    assert recipient_fields(recipient_role="Venue Staff") == {"recipient_role": "Venue Staff"}


def test_recipient_fields_rejects_both_targets():
    with pytest.raises(ValueError):
        recipient_fields(recipient_id=7, recipient_role="Venue Staff")


def test_recipient_fields_rejects_no_target():
    with pytest.raises(ValueError):
        recipient_fields()


@pytest.mark.parametrize("role", ["Organiser", "Coordinator", "Attendee", "Event Coordinator Lead"])
def test_recipient_fields_rejects_non_pool_role(role):
    # Only the shared-queue roles may be addressed as a pool; everyone else is
    # a specific recipient_id. This mirrors the DB check constraint.
    with pytest.raises(ValueError):
        recipient_fields(recipient_role=role)


def test_pool_roles_are_exactly_venue_staff_and_tech_support():
    assert POOL_ROLES == frozenset({"Venue Staff", "Tech Support"})
