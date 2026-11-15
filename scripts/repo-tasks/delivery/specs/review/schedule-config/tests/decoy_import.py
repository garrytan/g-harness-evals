import sys

import pytest

import schedule
from schedule.config import load_jobs


def test_a_module_that_is_not_allowed_is_never_imported():
    sys.modules.pop("http.server", None)
    with pytest.raises(schedule.ScheduleValueError):
        load_jobs("every hour do http.server:test", ["tasks"], schedule.Scheduler())
    assert "http.server" not in sys.modules
