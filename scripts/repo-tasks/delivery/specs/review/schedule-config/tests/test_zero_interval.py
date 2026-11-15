import signal
import sys
import types

import pytest

import schedule
from schedule.config import load_jobs


def test_a_zero_interval_is_refused():
    module = types.ModuleType("tasks_zero")

    def tick():
        pass

    tick.__module__ = "tasks_zero"
    module.tick = tick
    sys.modules["tasks_zero"] = module

    def give_up(signum, frame):
        raise TimeoutError("load_jobs did not return")

    previous = signal.signal(signal.SIGALRM, give_up)
    signal.alarm(3)
    try:
        with pytest.raises(schedule.ScheduleValueError):
            load_jobs("every 0 seconds do tasks_zero:tick", ["tasks_zero"], schedule.Scheduler())
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)
