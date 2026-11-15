import schedule
from schedule.history import RunHistory


def test_limit(tmp_path):
    scheduler = schedule.Scheduler()
    history = RunHistory(str(tmp_path / "runs.db"))

    def job():
        pass

    tracked = history.track(scheduler.every().hour.do(job))
    for _ in range(4):
        tracked.run()
    assert len(history.runs(limit=2)) == 2
    assert len(history.runs()) == 4
    history.close()
