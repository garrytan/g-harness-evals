import datetime

import pytest

import schedule
from schedule import ScheduleValueError, every, to_24_hour


@pytest.mark.parametrize(
    "text, expected",
    [
        ("7pm", "19:00"),
        ("7:30pm", "19:30"),
        ("7:30 PM", "19:30"),
        ("9am", "09:00"),
        ("12pm", "12:00"),
        ("11:59:30pm", "23:59:30"),
        ("10:30", "10:30"),
    ],
)
def test_to_24_hour(text, expected):
    assert to_24_hour(text) == expected


@pytest.mark.parametrize("text", ["7.30pm", "noon", "7:5pm", ""])
def test_invalid_times(text):
    with pytest.raises(ScheduleValueError):
        to_24_hour(text)


def test_daily_job_at_12_hour_time():
    schedule.clear()
    job = every().day.at("7:30pm").do(lambda: None)
    assert job.at_time == datetime.time(19, 30)
    job = every().friday.at("8am").do(lambda: None)
    assert job.at_time == datetime.time(8, 0)
    schedule.clear()
