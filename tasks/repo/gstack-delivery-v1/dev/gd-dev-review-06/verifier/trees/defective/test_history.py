"""Unit tests for schedule.history"""

import datetime
import os
import tempfile
import unittest

import schedule
from schedule.history import RunHistory


class RunHistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmpdir.name, "runs.db")
        self.now = datetime.datetime(2024, 5, 1, 12, 0, 0)
        self.scheduler = schedule.Scheduler()

    def tearDown(self):
        self.tmpdir.cleanup()

    def history(self, **kwargs):
        history = RunHistory(self.path, clock=lambda: self.now, **kwargs)
        self.addCleanup(history.close)
        return history

    def test_track_records_runs(self):
        def backup():
            return "done"

        history = self.history()
        job = history.track(self.scheduler.every(10).minutes.do(backup).tag("db"))
        self.assertIs(job, self.scheduler.jobs[0])
        self.assertEqual(job.run(), "done")
        self.assertEqual(history.last_success("backup"), self.now)
        self.now += datetime.timedelta(minutes=10)
        self.scheduler.run_all()

        runs = history.runs()
        self.assertEqual(len(runs), 2)
        self.assertEqual(runs[0]["job"], "backup")
        self.assertEqual(runs[0]["tags"], ["db"])
        self.assertEqual(runs[0]["started"], datetime.datetime(2024, 5, 1, 12, 10))
        self.assertEqual(runs[0]["seconds"], 0.0)
        self.assertIsNone(runs[0]["error"])
        self.assertEqual(runs[1]["started"], datetime.datetime(2024, 5, 1, 12, 0))
        self.assertIn("backup", repr(job))

    def test_exceptions_pass_through(self):
        def fail():
            raise ValueError("boom")

        history = self.history()
        job = history.track(self.scheduler.every().hour.do(fail))
        with self.assertRaises(ValueError):
            job.run()
        self.assertIsNone(history.last_success("fail"))

    def test_filters(self):
        def a():
            pass

        def b():
            pass

        history = self.history()
        history.track(self.scheduler.every().hour.do(a).tag("db", "nightly"))
        history.track(self.scheduler.every().hour.do(b).tag("web"))
        self.scheduler.run_all()
        self.scheduler.run_all()

        self.assertEqual(len(history.runs()), 4)
        self.assertEqual([r["job"] for r in history.runs(tag="db")], ["a", "a"])
        self.assertEqual([r["job"] for r in history.runs(tag="web")], ["b", "b"])
        self.assertEqual(history.runs(tag="nightly")[0]["tags"], ["db", "nightly"])
        self.assertEqual(len(history.runs(job="b", limit=1)), 1)
        self.assertEqual(history.runs(tag="missing"), [])

    def test_keep(self):
        def a():
            pass

        history = self.history(keep=3)
        job = history.track(self.scheduler.every().hour.do(a))
        for _ in range(5):
            job.run()
        self.assertEqual(len(history.runs()), 3)

    def test_invalid_arguments(self):
        with self.assertRaises(schedule.ScheduleValueError):
            RunHistory(self.path, table="1runs")
        with self.assertRaises(schedule.ScheduleValueError):
            RunHistory(self.path, keep=0)
        with self.assertRaises(schedule.ScheduleValueError):
            self.history().track(schedule.Job(1, self.scheduler))
