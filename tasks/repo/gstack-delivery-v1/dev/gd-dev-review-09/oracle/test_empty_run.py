from more_itertools import replayable


def test_a_run_that_yields_nothing_is_replayed():
    calls = []

    @replayable
    def matches(word):
        calls.append(word)
        yield from (c for c in word if c.isdigit())

    assert list(matches('abc')) == []
    assert list(matches('abc')) == []
    assert list(matches('abc')) == []
    assert calls == ['abc']
