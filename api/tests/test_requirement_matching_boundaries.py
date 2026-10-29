"""Venue requirement wording: hints, missing features and text utility edge cases."""

import pytest

from app.venue_suitability import (
    FacilityRule,
    LayoutRule,
    _levenshtein,
    _ngrams,
    find_requested,
)


@pytest.mark.parametrize("left,right,distance", [
    ("", "stage", 5), ("ramp", "", 4), ("", "", 0),
])
def test_empty_feature_names_have_the_expected_edit_distance(left, right, distance):
    assert _levenshtein(left, right) == distance


def test_phrase_windows_preserve_word_order_and_do_not_invent_partial_phrases():
    assert _ngrams("wheelchair accessible toilet", 2) == [
        "wheelchair accessible", "accessible toilet",
    ]
    assert _ngrams("wheelchair", 2) == []


def test_an_ambiguous_feature_fragment_does_not_become_a_requirement():
    assert find_requested("microphone", "micro") == (False, None)


def test_empty_facility_request_does_not_invent_a_warning():
    assert FacilityRule().evaluate({}, {}) is None


def test_an_unrelated_phrase_does_not_warn_about_supported_layouts():
    assert LayoutRule().evaluate({"venue_requirements": "quiet room"},
                                 {"supported_layouts": ["Theatre"]}) is None
