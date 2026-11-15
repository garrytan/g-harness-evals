from more_itertools import replayable


def test_func_is_not_called_on_a_replay():
    calls = []

    @replayable
    def pair(n):
        calls.append(n)
        return [n, n + 1]

    assert list(pair(1)) == [1, 2]
    assert list(pair(1)) == [1, 2]
    assert list(pair(1)) == [1, 2]
    assert calls == [1]
