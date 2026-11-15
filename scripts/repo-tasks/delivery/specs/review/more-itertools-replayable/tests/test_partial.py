import pytest

from more_itertools import replayable


def test_unfinished_runs_are_not_recorded():
    calls = []

    @replayable
    def numbers(n, fail=False):
        calls.append(n)
        yield from range(n)
        if fail:
            raise RuntimeError('boom')

    it = numbers(3)
    assert next(it) == 0
    it.close()
    assert list(numbers(3)) == [0, 1, 2]

    with pytest.raises(RuntimeError):
        list(numbers(2, fail=True))
    with pytest.raises(RuntimeError):
        list(numbers(2, fail=True))
    assert calls == [3, 3, 2, 2]
