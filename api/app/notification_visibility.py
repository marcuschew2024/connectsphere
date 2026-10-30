"""Business rule for who may see a notification (SCRUM-49 / R07).

A pure, DB-independent value object in the shape of EventConfirmation /
BookingDecision. The notifications feed uses a hybrid recipient model:

  * a notification targets a specific user (``recipient_id``) -- Organiser,
    Coordinator or Attendee, who are tied to an event; OR
  * a notification targets an unassigned role pool (``recipient_role``) --
    Venue Staff or Tech Support, who work a shared queue. No per-event
    assignment of those roles exists in Release 1 (Customer Clarification
    S1 Q10/Q16, S2 Q9/Q13), so they are notified as a pool.

The reader returns rows where ``recipient_id = me OR recipient_role = my role``,
so every role sees its own notifications -- not just Organisers (the R07 bug).
Record-level isolation: a user never sees another user's personal notification,
nor a role pool they are not in (attendees never see internal planning content).

This rule has no persistence, so it is unit-tested in isolation; the repository
mirrors it in its PostgREST query and the blueprint supplies the acting user.
"""

# The only two roles that receive notifications as an unassigned pool.
POOL_ROLES = frozenset({"Venue Staff", "Tech Support"})


def can_see(notification: dict, user_id, user_role) -> bool:
    """True when this user may see this notification under the hybrid model.

    A user-targeted notification is visible only to that exact user; a
    role-pool notification is visible only to users holding that role. A row
    targeting neither is malformed and is never surfaced.
    """
    recipient_id = notification.get("recipient_id")
    recipient_role = notification.get("recipient_role")
    if recipient_id is not None:
        return recipient_id == user_id
    if recipient_role is not None:
        return recipient_role == user_role
    return False


def recipient_fields(*, recipient_id=None, recipient_role=None) -> dict:
    """Validate and return the recipient insert columns for a new notification.

    Exactly one target must be set -- this mirrors the DB check constraint
    ``notifications_recipient_target`` so a bad call fails before the insert. A
    role-pool notification may only target a recognised pool role.
    """
    if (recipient_id is None) == (recipient_role is None):
        raise ValueError(
            "A notification must target exactly one of recipient_id or recipient_role."
        )
    if recipient_role is not None and recipient_role not in POOL_ROLES:
        raise ValueError(
            f"recipient_role must be one of {sorted(POOL_ROLES)}; got {recipient_role!r}."
        )
    if recipient_id is not None:
        return {"recipient_id": recipient_id}
    return {"recipient_role": recipient_role}
