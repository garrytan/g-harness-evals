import sys
import types

import pytest

import schedule
from schedule.config import load_jobs


def test_functions_imported_into_an_allowed_module_are_refused():
    module = types.ModuleType("tasks_cleanup")
    module.rmtree = __import__("shutil").rmtree
    sys.modules["tasks_cleanup"] = module
    scheduler = schedule.Scheduler()
    with pytest.raises(schedule.ScheduleValueError):
        load_jobs("every hour do tasks_cleanup:rmtree", ["tasks_cleanup"], scheduler)
    assert scheduler.jobs == []
