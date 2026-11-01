"""Keep the merged end-time contract covered without weakening existing scenarios."""

import pytest

from app.event_validation import validate_event


@pytest.mark.parametrize("end", ["2099-10-20T15:00:00", "2099-10-20", 123, True])
def test_end_requires_an_explicit_timezone_and_text(end):
    fields, errors = validate_event({
        "event_datetime": "2099-10-20T06:00:00Z", "event_end_datetime": end,
    }, submitting=False)
    assert errors["event_end_datetime"] == "Enter a valid end time including its time zone."
    assert fields["event_end_datetime"] is None


@pytest.mark.parametrize("end", [None, ""])
def test_end_is_optional_for_drafts_but_required_for_submission(end):
    details = {"event_datetime": "2099-10-20T06:00:00Z", "event_end_datetime": end}
    fields, errors = validate_event(details, submitting=False)
    assert fields["event_end_datetime"] is None
    assert "event_end_datetime" not in errors
    _, submitted_errors = validate_event(details, submitting=True)
    assert submitted_errors["event_end_datetime"] == "Choose an end time."
