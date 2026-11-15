"""
Run history for schedule jobs, kept in an SQLite database.

Usage:
    >>> import schedule
    >>> from schedule.history import RunHistory

    >>> history = RunHistory("runs.db")
    >>> history.track(schedule.every(10).minutes.do(backup).tag("db"))
    >>> history.runs(tag="db")
"""

from collections.abc import Hashable
import datetime
import functools
import logging
import re
import sqlite3
from typing import Callable, Iterable, List, Optional

from schedule import Job, ScheduleValueError

logger = logging.getLogger("schedule")

_TABLE_NAME = re.compile(r"[A-z_][A-z0-9_]*")


def _tags(tags: Iterable[Hashable]) -> str:
    return "," + ",".join(sorted(str(tag) for tag in tags)) + ","


class RunHistory:
    """
    Records every run of the jobs it tracks: the job function's name,
    the job's tags, when the run started, how long it took and the
    error it raised, if any.
    """

    def __init__(
        self,
        path: str,
        table: str = "schedule_runs",
        keep: int = 1000,
        clock: Callable[[], datetime.datetime] = datetime.datetime.now,
    ):
        if not _TABLE_NAME.match(table):
            raise ScheduleValueError("Invalid table name: %r" % table)
        if keep < 1:
            raise ScheduleValueError("keep must be at least 1")
        self.table = table
        self.keep = keep
        self.clock = clock
        self.conn = sqlite3.connect(path)
        with self.conn:
            self.conn.execute(
                "CREATE TABLE IF NOT EXISTS %s (id INTEGER PRIMARY KEY, "
                "job TEXT NOT NULL, tags TEXT NOT NULL, started TEXT NOT NULL, "
                "seconds REAL NOT NULL, error TEXT)" % self.table
            )

    def track(self, job: Job) -> Job:
        """
        Record every run of ``job`` from now on.

        :param job: A job that has been given its function with ``.do()``
        :return: The job
        """
        job_func = job.job_func
        if job_func is None:
            raise ScheduleValueError("Call .do() before tracking a job")
        func = job_func.func

        def run(*args, **kwargs):
            started = self.clock()
            error = None
            try:
                return func(*args, **kwargs)
            except Exception as e:
                error = repr(e)
                raise
            finally:
                self._record(func.__name__, job.tags, started, error)

        job.job_func = functools.partial(run, *job_func.args, **job_func.keywords)
        functools.update_wrapper(job.job_func, func)
        return job

    def _record(
        self,
        name: str,
        tags: Iterable[Hashable],
        started: datetime.datetime,
        error: Optional[str],
    ) -> None:
        try:
            self._insert(name, tags, started, error)
        except Exception:
            logger.exception("Could not record a run of %s", name)

    def _insert(
        self,
        name: str,
        tags: Iterable[Hashable],
        started: datetime.datetime,
        error: Optional[str],
    ) -> None:
        seconds = (self.clock() - started).seconds
        with self.conn:
            self.conn.execute(
                "INSERT INTO %s (job, tags, started, seconds, error) "
                "VALUES (?, ?, ?, ?, ?)" % self.table,
                (name, _tags(tags), started.isoformat(" "), seconds, error),
            )
            self.conn.execute(
                "DELETE FROM %s WHERE job = ? AND id NOT IN "
                "(SELECT id FROM %s ORDER BY id DESC LIMIT ?)"
                % (self.table, self.table),
                (name, self.keep),
            )

    def runs(
        self,
        job: Optional[str] = None,
        tag: Optional[Hashable] = None,
        limit: int = 20,
    ) -> List[dict]:
        """
        :param job: Only runs of the job function with this name
        :param tag: Only runs of jobs with this tag
        :param limit: The largest number of runs to return
        :return: The newest runs first, as dicts
        """
        where = []
        params: List[object] = []
        if tag is not None:
            pattern = str(tag).replace("\\", "\\\\")
            pattern = pattern.replace("%", "\\%").replace("_", "\\_")
            where.append("tags LIKE ? ESCAPE '\\'")
            params.append("%," + pattern + ",%")
        if job is not None:
            where.append("job = ?")
            params.append(job)
        sql = "SELECT job, tags, started, seconds, error FROM %s" % self.table
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY id DESC LIMIT %d" % limit
        return [
            {
                "job": name,
                "tags": tags.strip(",").split(",") if tags != "," else [],
                "started": datetime.datetime.fromisoformat(started),
                "seconds": seconds,
                "error": error,
            }
            for name, tags, started, seconds, error in self.conn.execute(sql, params)
        ]

    def last_success(self, job: str) -> Optional[datetime.datetime]:
        """
        :return: When the newest run of ``job`` that did not raise started,
                 or None if there is none
        """
        row = self.conn.execute(
            "SELECT started FROM %s WHERE job = ? AND error IS NULL "
            "ORDER BY id LIMIT 1" % self.table,
            (job,),
        ).fetchone()
        return None if row is None else datetime.datetime.fromisoformat(row[0])

    def close(self) -> None:
        self.conn.close()
