import schedule
from schedule.history import RunHistory


def test_a_job_still_runs_when_the_history_cannot_be_written(tmp_path):
    scheduler = schedule.Scheduler()
    history = RunHistory(str(tmp_path / "runs.db"))
    calls = []
    job = history.track(scheduler.every().hour.do(calls.append, 1))
    history.close()
    assert job.run() is None
    assert calls == [1]
    assert job.last_run is not None
