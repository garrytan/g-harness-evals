import pytest

import schedule
from schedule.history import RunHistory


def test_a_run_that_raises_is_recorded(tmp_path):
    scheduler = schedule.Scheduler()
    history = RunHistory(str(tmp_path / "runs.db"))

    def sync():
        raise ConnectionError("down")

    job = history.track(scheduler.every().hour.do(sync))
    with pytest.raises(ConnectionError):
        job.run()
    runs = history.runs(job="sync")
    assert len(runs) == 1
    assert "ConnectionError" in runs[0]["error"]
    history.close()
