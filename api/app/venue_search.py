"""SCRUM-28: validate filters, search the catalogue, and flag unavailable venues."""

import re
from datetime import date, datetime
from zoneinfo import ZoneInfo

from werkzeug.exceptions import BadRequest

from .booking_repository import find_overlapping_bookings
from .venue_repository import PAGE_SIZE, list_venues
from .venue_validation import DAYS

FILTERS = {"location", "attendance", "capacity", "layout", "facilities", "accessibility",
           "date", "start_time", "end_time", "available_only"}


def _normalise(value):
    return " ".join(value.split()).casefold()


def parse_filters(args):
    """Accept optional metadata filters and one complete, same-day Singapore slot."""
    if set(args) - FILTERS - {"page"} or any(len(args.getlist(key)) != 1 for key in args):
        raise BadRequest("Use each supported search filter only once.")
    filters = {key: value.strip() for key, value in args.items()
               if key in FILTERS and value.strip()}
    if "available_only" in filters:
        if filters["available_only"] not in {"true", "false"}:
            raise BadRequest("Use true or false for available_only.")
        filters["available_only"] = filters["available_only"] == "true"
    for key in ("attendance", "capacity"):
        if key not in filters:
            continue
        value = filters[key]
        if (not value.isascii() or not value.isdecimal() or len(value) > 10
                or not 1 <= int(value) <= 2_147_483_647):
            raise BadRequest(f"Enter a positive whole number for {key} (up to 2147483647).")
        filters[key] = int(value)
    for key, limit in (("location", 300), ("layout", 80)):
        if key in filters:
            if len(filters[key]) > limit:
                raise BadRequest(f"Keep {key} within {limit} characters.")
            filters[key] = _normalise(filters[key])
    for key in ("facilities", "accessibility"):
        if key in filters:
            values = [_normalise(value) for value in filters[key].split(",")]
            if len(values) > 20 or any(not value or len(value) > 80 for value in values):
                raise BadRequest(f"Enter up to 20 comma-separated {key}, each 1–80 characters.")
            filters[key] = set(values)
    slot_keys = {"date", "start_time", "end_time"}
    if slot_keys & filters.keys():
        if not slot_keys <= filters.keys():
            raise BadRequest("Choose a date, start time and end time together (Singapore time).")
        try:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", filters["date"], re.ASCII):
                raise ValueError
            day = date.fromisoformat(filters["date"])
            for key in ("start_time", "end_time"):
                if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", filters[key], re.ASCII):
                    raise ValueError
            if filters["start_time"] >= filters["end_time"]:
                raise ValueError
        except ValueError as error:
            raise BadRequest("Choose a valid date and an end time after the start on that day.") \
                from error
        filters["weekday"] = DAYS[day.weekday()]
        for key in ("start_time", "end_time"):
            filters[key + "_iso"] = datetime.fromisoformat(
                f"{day.isoformat()}T{filters[key]}"
            ).replace(tzinfo=ZoneInfo("Asia/Singapore")).isoformat()
    if filters.get("available_only") and "date" not in filters:
        raise BadRequest("Choose a date and both times to show only available venues.")
    return filters


def matches_filters(venue, filters):
    """Every chosen feature is required; capacity and attendance are minimums."""
    minimum = max(filters.get("attendance", 0), filters.get("capacity", 0))
    if venue["capacity"] < minimum:
        return False
    if filters.get("location", "") not in _normalise(venue["location"]):
        return False
    layouts = {_normalise(value) for value in venue["supported_layouts"]}
    if "layout" in filters and filters["layout"] not in layouts:
        return False
    for key in ("facilities", "accessibility"):
        available = {_normalise(value) for value in venue[key]}
        if not filters.get(key, set()) <= available:
            return False
    return True


def availability(venue, filters):
    """Use SCRUM-31's existing half-open conflict check; never reserve a venue here."""
    if venue.get("is_retired", False):
        return "retired"
    if "date" not in filters:
        return "not_checked"
    hours = venue["operating_hours"][filters["weekday"]]
    if (not hours or filters["start_time"] < hours["opens"]
            or filters["end_time"] > hours["closes"]):
        return "closed"
    conflicts = find_overlapping_bookings(
        venue["id"], filters["start_time_iso"], filters["end_time_iso"]
    )
    if any(row["status"] == "Blocked" for row in conflicts):
        return "blocked"
    if conflicts:
        return "booked"
    return "available"


def search_venues(page, filters):
    """Filter before pagination, including matches beyond the first catalogue page.

    Read existing pages until we have this result page plus one look-ahead match.
    This keeps the shared repository and suitability endpoint contracts intact.
    """
    start = (page - 1) * PAGE_SIZE
    matches = []
    source_page = 1
    matched_count = 0
    checked = {}
    while len(matches) <= PAGE_SIZE:
        rows, has_more = list_venues(source_page)
        for venue in rows:
            if not matches_filters(venue, filters):
                continue
            if filters.get("available_only"):
                checked[venue["id"]] = availability(venue, filters)
                if checked[venue["id"]] != "available":
                    continue
            if matched_count >= start:
                matches.append(venue)
            matched_count += 1
            if len(matches) > PAGE_SIZE:
                break
        if not has_more or len(matches) > PAGE_SIZE:
            break
        source_page += 1
    return [
        {**venue, "search_availability": checked[venue["id"]] if venue["id"] in checked
         else availability(venue, filters)}
        for venue in matches[:PAGE_SIZE]
    ], len(matches) > PAGE_SIZE


def filter_options():
    """Suggest actual catalogue vocabulary, including features on later pages."""
    options = {key: {} for key in ("facilities", "accessibility")}
    page = 1
    while True:
        rows, has_more = list_venues(page)
        for venue in rows:
            if venue.get("is_retired"):
                continue
            for key in options:
                for value in venue[key]:
                    options[key].setdefault(_normalise(value), value)
        if not has_more:
            break
        page += 1
    return {key: sorted(values.values(), key=_normalise) for key, values in options.items()}
