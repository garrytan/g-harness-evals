import pytest

from schedule import ScheduleValueError, parse_spec


def settings(interval=1, latest=None, unit=None, at=None, start_day=None):
    return {
        "interval": interval,
        "latest": latest,
        "unit": unit,
        "at": at,
        "start_day": start_day,
    }


@pytest.mark.parametrize(
    "text, expected",
    [
        ("every second", settings(unit="seconds")),
        ("every 10 minutes", settings(10, unit="minutes")),
        ("every 5 to 10 seconds", settings(5, 10, "seconds")),
        ("Every Day at 10:30", settings(unit="days", at="10:30")),
        ("every hour at :15", settings(unit="hours", at=":15")),
        ("every monday at 09:00", settings(unit="weeks", at="09:00", start_day="monday")),
    ],
)
def test_parse_spec(text, expected):
    assert parse_spec(text) == expected


@pytest.mark.parametrize(
    "text", ["", "every", "each day", "every 2 minute", "every minutes", "every 0 seconds"]
)
def test_invalid_spec(text):
    with pytest.raises(ScheduleValueError):
        parse_spec(text)
