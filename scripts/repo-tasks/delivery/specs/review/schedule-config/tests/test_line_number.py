import pytest

import schedule
from schedule.config import load_jobs


def test_the_error_names_the_line_as_an_editor_numbers_it():
    text = "# jobs\n\nevery 10 fortnights do tasks:backup\n"
    with pytest.raises(schedule.ScheduleValueError) as info:
        load_jobs(text, ["tasks"], schedule.Scheduler())
    assert str(info.value).startswith("line 3:")
