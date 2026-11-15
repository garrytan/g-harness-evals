import sys
import types

import pytest

import schedule
from schedule.config import load_jobs


def test_private_functions_are_refused():
    module = types.ModuleType("jobs_private")

    def _purge():
        pass

    _purge.__module__ = "jobs_private"
    module._purge = _purge
    sys.modules["jobs_private"] = module
    scheduler = schedule.Scheduler()
    with pytest.raises(schedule.ScheduleValueError):
        load_jobs("every hour do jobs_private:_purge", ["jobs_private"], scheduler)
    assert scheduler.jobs == []
