import pytest

import schedule
from schedule.config import load_jobs


@pytest.mark.parametrize("unit", ["do", "tag", "until", "run", "__class__"])
def test_only_units_reach_getattr(unit):
    scheduler = schedule.Scheduler()
    with pytest.raises(schedule.ScheduleValueError):
        load_jobs("every 1 %s do tasks:backup" % unit, ["tasks"], scheduler)
    assert scheduler.jobs == []
