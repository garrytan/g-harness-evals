import schedule
from schedule.history import RunHistory


def test_keep_counts_each_job_separately(tmp_path):
    scheduler = schedule.Scheduler()
    history = RunHistory(str(tmp_path / "runs.db"), keep=2)

    def a():
        pass

    def b():
        pass

    job_a = history.track(scheduler.every().hour.do(a))
    job_b = history.track(scheduler.every().hour.do(b))
    job_a.run()
    job_b.run()
    job_a.run()
    assert len(history.runs(job="a")) == 2
    history.close()
