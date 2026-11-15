import pytest

import schedule


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
        ("every minute", settings(unit="minutes")),
        ("every 10 minutes", settings(10, unit="minutes")),
        ("Every 1 Seconds", settings(1, unit="seconds")),
        ("every 5 to 10 seconds", settings(5, 10, "seconds")),
        ("every 3 to 3 hours", settings(3, 3, "hours")),
        ("every day at 10:30", settings(unit="days", at="10:30")),
        ("every 2 days at 08:15:30", settings(2, unit="days", at="08:15:30")),
        ("every hour at :15", settings(unit="hours", at=":15")),
        ("every 2 hours at 30:05", settings(2, unit="hours", at="30:05")),
        ("every minute at :45", settings(unit="minutes", at=":45")),
        ("every week", settings(unit="weeks")),
        ("every 2 weeks", settings(2, unit="weeks")),
        ("every monday", settings(unit="weeks", start_day="monday")),
        ("  every   Friday  AT 17:00 ", settings(unit="weeks", at="17:00", start_day="friday")),
        ("every tue at 09:00", settings(unit="weeks", at="09:00", start_day="tuesday")),
        ("EVERY SUN", settings(unit="weeks", start_day="sunday")),
    ],
)
def test_parse_spec(text, expected):
    assert schedule.parse_spec(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "",
        "every",
        "each day",
        "every 2 minute",
        "every minutes",
        "every 0 seconds",
        "every 5 to 2 minutes",
        "every 2 mondays",
        "every 2 monday",
        "every fortnight",
        "every mo",
        "every minute at 10:30",
        "every 5 seconds at :30",
        "every 2 weeks at 10:00",
        "every day at 25:00",
        "every day at :30",
        "every hour at 10:30:00",
        "every day at",
        "every day at 10:30 sharp",
    ],
)
def test_invalid_spec(text):
    with pytest.raises(Exception) as raised:
        schedule.parse_spec(text)
    assert type(raised.value).__name__ in ("ScheduleValueError", "IntervalError")


def test_main_weekday_names_still_work():
    assert schedule._parse_weekday("Tue") == "tuesday"
    assert schedule._parse_weekday("SUNDAY") == "sunday"
