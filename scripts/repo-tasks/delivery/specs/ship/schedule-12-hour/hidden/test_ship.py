import pytest

import schedule


@pytest.mark.parametrize(
    "text, expected",
    [
        ("7pm", "19:00"),
        ("7 PM", "19:00"),
        ("7:30pm", "19:30"),
        ("7:30 Pm", "19:30"),
        ("11:59:30pm", "23:59:30"),
        ("9:05am", "09:05"),
        ("1am", "01:00"),
        ("12am", "00:00"),
        ("12:15am", "00:15"),
        ("12:00:01 AM", "00:00:01"),
        ("12pm", "12:00"),
        ("12:45pm", "12:45"),
        ("09:05", "09:05"),
        ("9:30", "09:30"),
        ("0:00", "00:00"),
        ("21:05:09", "21:05:09"),
        ("23:59", "23:59"),
    ],
)
def test_to_24_hour(text, expected):
    assert schedule.to_24_hour(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "13pm",
        "0am",
        "00:30am",
        "19:30pm",
        "7:60pm",
        "7:5pm",
        "24:00",
        "25:30",
        "9",
        "7.30pm",
        "7 p.m.",
        "noon",
        "",
    ],
)
def test_invalid_times(text):
    with pytest.raises(Exception) as raised:
        schedule.to_24_hour(text)
    assert type(raised.value).__name__ == "ScheduleValueError"


def test_main_daily_time_parsing_still_works():
    assert schedule._parse_time_of_day("9:30") == (9, 30, 0)
    assert schedule._parse_time_of_day("23:59:59") == (23, 59, 59)
