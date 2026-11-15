import sys
import types

import pytest

import schedule
from schedule.config import load_jobs


def test_an_invalid_line_schedules_nothing():
    module = types.ModuleType("tasks_atomic")

    def backup():
        pass

    backup.__module__ = "tasks_atomic"
    module.backup = backup
    sys.modules["tasks_atomic"] = module
    scheduler = schedule.Scheduler()
    text = "every 10 minutes do tasks_atomic:backup\nevery 10 fortnights do tasks_atomic:backup\n"
    with pytest.raises(schedule.ScheduleValueError):
        load_jobs(text, ["tasks_atomic"], scheduler)
    assert scheduler.jobs == []
