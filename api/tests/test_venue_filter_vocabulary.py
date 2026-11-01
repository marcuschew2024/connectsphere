"""SCRUM-161: preserve SCRUM-162 vocabulary and validate its ordering boundaries."""

import pytest
from werkzeug.datastructures import MultiDict
from werkzeug.exceptions import BadRequest

from app.venue_search import _unique_preserving_preferred, filter_options, parse_filters


@pytest.mark.parametrize("values", [
    [None, 7, "  ", "projector", "Projector", " PROJECTOR "],
    [" PROJECTOR ", "Projector", "projector", "  ", 7, None],
    ["projector", "Projector", " Projector ", " Projector  "],
])
def test_suggestion_spelling_ignores_invalid_values_and_prefers_title_case_in_either_order(values):
    assert _unique_preserving_preferred(values) == ["Projector"]


def test_filter_options_retains_canonical_choices_with_incomplete_or_retired_records(monkeypatch):
    monkeypatch.setattr("app.venue_search.list_venues", lambda page: ([
        {"facilities": None, "accessibility": []},
        {"facilities": [" Video wall ", None, 7, ""], "accessibility": ["Tactile maps"]},
        {"is_retired": True, "facilities": ["Retired only"], "accessibility": []},
    ], False))
    options = filter_options()
    assert "Projector" in options["facilities"]
    assert "Video wall" in options["facilities"]
    assert "Retired only" not in options["facilities"]
    assert "Wheelchair" in options["accessibility"]
    assert "Tactile maps" in options["accessibility"]
    assert all(
        isinstance(value, str) and value.strip()
        for values in options.values() for value in values
    )


@pytest.mark.parametrize("layout", ["Classroom,", "x" * 81, ",".join(["Classroom"] * 21)])
def test_multiple_layout_filter_rejects_empty_oversized_and_excessive_entries(layout):
    with pytest.raises(BadRequest, match="up to 20 comma-separated layouts"):
        parse_filters(MultiDict({"layout": layout}))
