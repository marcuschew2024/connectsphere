"""Tech Support maintains equipment; Coordinators can read the shared catalogue."""

from flask import Blueprint, current_app, jsonify, request
from werkzeug.exceptions import BadRequest, Forbidden, HTTPException, NotFound, Unauthorized

from .acting_user import get_acting_user
from .auth import get_authenticated_user
from .equipment_repository import get_equipment, list_equipment, save_equipment
from .equipment_validation import FIELDS, MAX_QUANTITY, validate_equipment
from .rbac import require_role

equipment = Blueprint("equipment", __name__, url_prefix="/equipment")


@equipment.after_request
def prevent_caching(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@equipment.errorhandler(HTTPException)
def json_error(error):
    return jsonify({"error": error.description}), error.code


def _require_user(*roles):
    if request.headers.get("Origin") != current_app.config["FRONTEND_ORIGIN"]:
        raise Forbidden("Request must come from the configured frontend origin.")
    user = get_authenticated_user() or get_acting_user()
    if user is None:
        raise Unauthorized("Sign in or select a demo user first.")
    action = "view_equipment_catalogue" if request.method == "GET" else "maintain_equipment"
    return require_role(user, *roles, action=action)


def _save(equipment_id: str | None = None):
    user = _require_user("Tech Support")
    data = request.get_json(silent=True)
    expected = FIELDS | ({"revision"} if equipment_id else set())
    if not isinstance(data, dict) or set(data) - expected:
        raise BadRequest(
            "Send equipment details only. Identity and timestamps are recorded automatically."
        )
    revision = data.get("revision")
    if equipment_id and (type(revision) is not int or not 1 <= revision <= MAX_QUANTITY):
        raise BadRequest("Reload the equipment before saving your changes.")
    fields, errors = validate_equipment(data)
    if errors:
        return jsonify({"error": "Please check the highlighted fields.", "fields": errors}), 400
    saved = save_equipment(fields, user["id"], equipment_id, revision)
    return jsonify({"equipment": saved}), 200 if equipment_id else 201


@equipment.post("")
def add_equipment():
    return _save()


@equipment.put("/<uuid:equipment_id>")
def edit_equipment(equipment_id):
    return _save(str(equipment_id))


@equipment.get("")
def catalogue():
    _require_user("Tech Support", "Coordinator")
    if set(request.args) - {"page", "operational_only"} or any(
        len(request.args.getlist(key)) != 1 for key in request.args
    ):
        raise BadRequest("Use page and operational_only to filter the catalogue.")
    page = request.args.get("page", "1")
    if not page.isascii() or not page.isdecimal() or len(page) > 5 or not 1 <= int(page) <= 10000:
        raise BadRequest("Choose a catalogue page from 1 to 10000.")
    operational_only = request.args.get("operational_only", "false")
    if operational_only not in {"true", "false"}:
        raise BadRequest("operational_only must be true or false.")
    rows, has_more = list_equipment(int(page), operational_only == "true")
    return jsonify({"equipment": rows, "page": int(page), "has_more": has_more})


@equipment.get("/<uuid:equipment_id>")
def equipment_detail(equipment_id):
    _require_user("Tech Support", "Coordinator")
    row = get_equipment(str(equipment_id))
    if row is None:
        raise NotFound("Equipment not found.")
    return jsonify({"equipment": row})


@equipment.get("/<uuid:equipment_id>/availability")
def equipment_availability(equipment_id):
    _require_user("Tech Support", "Coordinator")
    row = get_equipment(str(equipment_id))
    if row is None:
        raise NotFound("Equipment not found.")

    start_at = request.args.get("start_at")
    end_at = request.args.get("end_at")
    quantity_str = request.args.get("quantity", "1")

    if not start_at or not end_at:
        raise BadRequest("start_at and end_at query parameters are required.")

    try:
        quantity = int(quantity_str)
        if quantity < 0 or quantity > MAX_QUANTITY:
            raise ValueError
    except (ValueError, TypeError) as err:
        raise BadRequest("Quantity must be a non-negative integer.") from err

    try:
        from .equipment_availability import EquipmentAvailabilityEngine
        from .equipment_repository import get_reservations_for_window

        reservations = get_reservations_for_window(start_at, end_at, str(equipment_id))
        engine = EquipmentAvailabilityEngine()
        result = engine.check_availability(
            row,
            start_at,
            end_at,
            reservations,
            requested_quantity=quantity,
        )
    except ValueError as val_err:
        raise BadRequest(str(val_err)) from val_err

    return jsonify({
        "availability": {
            "equipment_id": result.equipment_id,
            "equipment_type": result.equipment_type,
            "total_quantity": result.total_quantity,
            "operational_status": result.operational_status,
            "usable_quantity": result.usable_quantity,
            "reserved_quantity": result.reserved_quantity,
            "available_quantity": result.available_quantity,
            "requested_quantity": quantity,
            "is_sufficient": result.is_sufficient,
            "overlapping_reservations_count": result.overlapping_reservations_count,
            "start_at": start_at,
            "end_at": end_at,
        }
    })

