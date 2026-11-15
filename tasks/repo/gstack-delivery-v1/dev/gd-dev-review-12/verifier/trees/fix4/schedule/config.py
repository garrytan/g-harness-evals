"""
Load jobs from configuration text, in the same words as the Python API.

Usage:
    >>> import schedule
    >>> from schedule.config import load_jobs

    >>> load_jobs(open("jobs.txt").read(), allowed=["tasks"])

Each line describes one job::

    every 10 minutes do tasks.backup:run
    every monday at 09:00 do tasks.reports:weekly tags reports,mail
    every 5 to 10 seconds do tasks.queue:poll

Blank lines and lines starting with ``#`` are ignored.
"""

import importlib
import re
from typing import Callable, Iterable, List, Optional

from schedule import (
    Job,
    Scheduler,
    ScheduleError,
    ScheduleValueError,
    default_scheduler,
)

_LINE = re.compile(
    r"every(?:\s+(\d+)(?:\s+to\s+(\d+))?)?\s+(\w+)(?:\s+at\s+(\S+))?"
    r"\s+do\s+([\w.]+):(\w+)(?:\s+tags\s+(\S+))?"
)

_UNITS = {
    "second",
    "seconds",
    "minute",
    "minutes",
    "hour",
    "hours",
    "day",
    "days",
    "week",
    "weeks",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
}


def _allowed(module: str, allowed: List[str]) -> bool:
    return any(module.startswith(name) for name in allowed)


def _resolve(module: str, name: str, allowed: List[str]) -> Callable:
    if not _allowed(module, allowed):
        raise ScheduleValueError("module %r is not allowed" % module)
    try:
        func = getattr(importlib.import_module(module), name)
    except ImportError as e:
        raise ScheduleValueError("cannot import %r: %s" % (module, e)) from e
    except AttributeError:
        raise ScheduleValueError("%r has no %r" % (module, name)) from None
    if not callable(func):
        raise ScheduleValueError("%s:%s cannot be scheduled" % (module, name))
    return func


def _job(
    scheduler: Scheduler,
    interval: Optional[str],
    latest: Optional[str],
    unit: str,
    at: Optional[str],
    tags: Optional[str],
) -> Job:
    job = Job(int(interval or 1), scheduler)
    if latest is not None:
        if int(latest) < job.interval:
            raise ScheduleValueError("%s is less than the interval" % latest)
        job.to(int(latest))
    if tags is not None:
        job.tag(*tags.split(","))
    job = getattr(job, unit)
    if at is not None:
        job.at(at)
    return job


def load_jobs(
    text: str, allowed: Iterable[str], scheduler: Optional[Scheduler] = None
) -> List[Job]:
    """
    Schedule the jobs described in ``text``.

    :param text: One job per line
    :param allowed: The modules whose functions may be scheduled,
        with their submodules
    :param scheduler: The scheduler to add the jobs to,
        the default scheduler if None
    :return: The scheduled jobs, in the order of the text
    :raises ScheduleValueError: If a line is invalid. Then no job is
        scheduled.
    """
    if scheduler is None:
        scheduler = default_scheduler
    allowed = list(allowed)
    entries = []
    for number, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = _LINE.fullmatch(line)
        try:
            if match is None or match.group(3) not in _UNITS:
                raise ScheduleValueError("cannot parse %r" % line)
            interval, latest, unit, at, module, name, tags = match.groups()
            func = _resolve(module, name, allowed)
            job = _job(scheduler, interval, latest, unit, at, tags)
        except ScheduleError as e:
            raise ScheduleValueError("line %d: %s" % (number, e)) from e
        entries.append((job, func))
    return [job.do(func) for job, func in entries]
