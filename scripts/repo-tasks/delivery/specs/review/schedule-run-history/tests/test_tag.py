import schedule
from schedule.history import RunHistory


def test_tag_filter_is_an_exact_match(tmp_path):
    scheduler = schedule.Scheduler()
    history = RunHistory(str(tmp_path / "runs.db"))

    def first():
        pass

    def second():
        pass

    history.track(scheduler.every().hour.do(first).tag("db_1"))
    history.track(scheduler.every().hour.do(second).tag("dbx1"))
    scheduler.run_all()
    assert [r["job"] for r in history.runs(tag="db_1")] == ["first"]
    history.close()
