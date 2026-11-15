"""Unit tests for schedule.config"""

import datetime
import sys
import types
import unittest

import schedule
from schedule.config import load_jobs


def make_module(name, **functions):
    module = types.ModuleType(name)
    for func_name, func in functions.items():
        func.__module__ = name
        func.__name__ = func_name
        setattr(module, func_name, func)
    sys.modules[name] = module
    return module


class LoadJobsTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.scheduler = schedule.Scheduler()
        make_module("tasks", backup=lambda: self.calls.append("backup"))
        make_module(
            "tasks.reports",
            weekly=lambda: self.calls.append("weekly"),
            poll=lambda: self.calls.append("poll"),
        )

    def tearDown(self):
        sys.modules.pop("tasks", None)
        sys.modules.pop("tasks.reports", None)

    def test_load_jobs(self):
        text = """
        # nightly jobs
        every 10 minutes do tasks:backup
        every monday at 09:00 do tasks.reports:weekly tags reports,mail

        every 5 to 10 seconds do tasks.reports:poll
        """
        jobs = load_jobs(text, ["tasks"], self.scheduler)
        self.assertEqual(self.scheduler.jobs, jobs)
        self.assertEqual((jobs[0].interval, jobs[0].unit), (10, "minutes"))
        self.assertEqual(jobs[1].start_day, "monday")
        self.assertEqual(jobs[1].at_time, datetime.time(9, 0))
        self.assertEqual(jobs[1].tags, {"reports", "mail"})
        self.assertEqual((jobs[2].interval, jobs[2].latest), (5, 10))
        self.scheduler.run_all()
        self.assertEqual(self.calls, ["backup", "weekly", "poll"])

    def test_default_scheduler(self):
        schedule.clear()
        self.addCleanup(schedule.clear)
        jobs = load_jobs("every hour do tasks:backup", ["tasks"])
        self.assertEqual(schedule.jobs, jobs)

    def test_invalid_lines(self):
        for line in [
            "every 10 do tasks:backup",
            "every 10 fortnights do tasks:backup",
            "every 2 mondays do tasks:backup",
            "every 10 to 5 minutes do tasks:backup",
            "every hour do tasks:missing",
            "every hour do os:getcwd",
            "every day at 25:00 do tasks:backup",
        ]:
            with self.assertRaises(schedule.ScheduleValueError, msg=line):
                load_jobs(line, ["tasks"], self.scheduler)
        self.assertEqual(self.scheduler.jobs, [])
