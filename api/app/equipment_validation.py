"""Validate catalogue stock; event-specific availability belongs to SCRUM-36."""

STATUSES = {"Operational", "Damaged", "Under Maintenance"}
TEXT_LIMITS = {"equipment_type": 100, "description": 2000, "location": 300}
FIELDS = set(TEXT_LIMITS) | {"total_quantity", "operational_status"}
MAX_QUANTITY = 2147483647


def validate_equipment(data: dict) -> tuple[dict, dict]:
    clean, errors = {}, {}
    for field, limit in TEXT_LIMITS.items():
        value = data.get(field)
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
            errors[field] = f"Enter between 1 and {limit} characters."
        else:
            clean[field] = value.strip()

    quantity = data.get("total_quantity")
    # bool is a subclass of int in Python, so use an exact type check.
    if type(quantity) is not int or not 0 <= quantity <= MAX_QUANTITY:
        errors["total_quantity"] = f"Enter a whole number from 0 to {MAX_QUANTITY}."
    else:
        clean["total_quantity"] = quantity

    status = data.get("operational_status")
    if not isinstance(status, str) or status not in STATUSES:
        errors["operational_status"] = "Choose Operational, Damaged or Under Maintenance."
    else:
        clean["operational_status"] = status
    return clean, errors
