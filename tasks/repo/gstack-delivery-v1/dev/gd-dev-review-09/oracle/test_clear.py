from more_itertools import replayable


def test_a_run_that_overlaps_a_clear_records_nothing():
    calls = []

    @replayable
    def numbers(n):
        calls.append(n)
        yield from range(n)

    it = numbers(2)
    assert next(it) == 0
    numbers.cache_clear()
    assert list(it) == [1]
    assert list(numbers(2)) == [0, 1]
    assert calls == [2, 2]
