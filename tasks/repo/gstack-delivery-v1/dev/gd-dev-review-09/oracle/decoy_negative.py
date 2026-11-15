from more_itertools import replayable


def test_a_negative_maxsize_keeps_nothing():
    calls = []

    @replayable(maxsize=-1)
    def numbers(n):
        calls.append(n)
        yield from range(n)

    assert list(numbers(2)) == [0, 1]
    assert list(numbers(2)) == [0, 1]
    assert calls == [2, 2]
    assert numbers.cache_info()[2] == 0
