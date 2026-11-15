from more_itertools import replayable


def test_the_newest_result_is_kept():
    calls = []

    @replayable(maxsize=1)
    def numbers(n):
        calls.append(n)
        yield from range(n)

    assert list(numbers(1)) == [0]
    assert list(numbers(2)) == [0, 1]
    assert list(numbers(2)) == [0, 1]
    assert calls == [1, 2]
    assert numbers.cache_info() == (1, 2, 1)
