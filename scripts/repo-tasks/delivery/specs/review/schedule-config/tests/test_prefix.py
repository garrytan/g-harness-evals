import sys
import types

import pytest

import schedule
from schedule.config import load_jobs


def test_a_module_that_only_shares_a_prefix_is_not_allowed():
    module = types.ModuleType("tasks_admin")

    def drop_all():
        pass

    drop_all.__module__ = "tasks_admin"
    module.drop_all = drop_all
    sys.modules["tasks_admin"] = module
    scheduler = schedule.Scheduler()
    with pytest.raises(schedule.ScheduleValueError):
        load_jobs("every hour do tasks_admin:drop_all", ["tasks"], scheduler)
    assert scheduler.jobs == []
