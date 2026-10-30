import pytest
import schedule


def test_limit_preserves_registration_order():
    scheduler = schedule.Scheduler()
    jobs = [scheduler.every().day.do(lambda: None) for _ in range(3)]
    assert scheduler.get_jobs(limit=2) == jobs[:2]
    assert scheduler.get_jobs(limit=5) == jobs
    assert scheduler.get_jobs() == jobs


def test_limit_applies_after_filtering():
    scheduler = schedule.Scheduler()
    scheduler.every().day.do(lambda: None).tag('other')
    first = scheduler.every().day.do(lambda: None).tag('selected')
    scheduler.every().day.do(lambda: None).tag('selected')
    assert scheduler.get_jobs('selected', limit=1) == [first]
    assert scheduler.get_jobs('missing', limit=1) == []
    with pytest.raises(ValueError):
        scheduler.get_jobs(limit=-1)


def test_module_shortcut(monkeypatch):
    scheduler = schedule.Scheduler()
    monkeypatch.setattr(schedule, 'default_scheduler', scheduler)
    first = scheduler.every().day.do(lambda: None)
    scheduler.every().day.do(lambda: None)
    assert schedule.get_jobs(limit=1) == [first]
