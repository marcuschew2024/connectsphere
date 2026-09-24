"""Shared venue data contract for creation, searching and suitability checks."""

import re

DAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
TEXT_LIMITS = {"name": 200, "location": 300}
LIST_FIELDS = ("facilities", "accessibility", "supported_layouts")
TIME = re.compile(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]\Z")
FIELDS = {*TEXT_LIMITS, *LIST_FIELDS, "capacity", "operating_hours"}


def validate_venue(data: dict) -> tuple[dict, dict]:
    """Normalise known fields and report actionable errors without coercing bad types."""
    clean, errors = {}, {}
    for field, limit in TEXT_LIMITS.items():
        value = data.get(field)
        if not isinstance(value, str) or not value.strip():
            errors[field] = "This field is required."
        elif len(value.strip()) > limit:
            errors[field] = f"Use {limit} characters or fewer."
        else:
            clean[field] = " ".join(value.split())

    capacity = data.get("capacity")
    if type(capacity) is not int or not 1 <= capacity <= 2_147_483_647:
        errors["capacity"] = "Enter a whole number between 1 and 2,147,483,647."
    else:
        clean["capacity"] = capacity

    for field in LIST_FIELDS:
        values = data.get(field)
        if not isinstance(values, list) or len(values) > 20 or any(
            not isinstance(value, str) or not value.strip() or len(value.strip()) > 80
            for value in values
        ):
            errors[field] = "Use a list of up to 20 features, each 1–80 characters."
            continue
        unique = {}
        for value in values:
            normalised = " ".join(value.split())
            unique.setdefault(normalised.casefold(), normalised)
        clean[field] = list(unique.values())
        if field == "supported_layouts" and not unique:
            errors[field] = "Choose at least one supported layout."

    hours = data.get("operating_hours")
    if not isinstance(hours, dict) or set(hours) != set(DAYS):
        errors["operating_hours"] = "Set opening hours or mark Closed for all seven days."
    else:
        for day, slot in hours.items():
            if slot is None:
                continue
            if (
                not isinstance(slot, dict) or set(slot) != {"opens", "closes"}
                or any(not isinstance(slot[key], str) or not TIME.fullmatch(slot[key])
                       for key in ("opens", "closes"))
                or slot["opens"] >= slot["closes"]
            ):
                errors[f"operating_hours.{day}"] = (
                    "Use valid times with closing later than opening on the same day."
                )
        if all(slot is None for slot in hours.values()):
            errors["operating_hours"] = "Open the venue on at least one day."
        clean["operating_hours"] = hours
    return clean, errors
