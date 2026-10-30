import pytest
import schedule


@pytest.mark.parametrize('tag', [None, 'selected'])
def test_zero_limit_returns_no_jobs(tag):
    scheduler = schedule.Scheduler()
    job = scheduler.every().day.do(lambda: None).tag('selected')
    assert scheduler.get_jobs(tag, limit=0) == []
    assert scheduler.jobs == [job]
