import pytest

from more_itertools import replayable


class BadHash:
    def __hash__(self):
        raise RuntimeError('no hash')


def test_calls_that_cannot_be_hashed_go_straight_to_func():
    calls = []

    @replayable
    def numbers(values, extra=None):
        calls.append(1)
        if extra == 'raise':
            raise TypeError('from func')
        yield from values

    assert list(numbers([1, 2])) == [1, 2]
    assert list(numbers([1, 2])) == [1, 2]
    assert list(numbers((3,), extra=BadHash())) == [3]
    assert calls == [1, 1, 1]
    assert numbers.cache_info() == (0, 0, 0)
    with pytest.raises(TypeError):
        list(numbers([1], extra='raise'))
