from more_itertools import replayable


def test_keyword_arguments_never_match_positional_ones():
    calls = []

    @replayable
    def show(*args, **kwargs):
        calls.append(1)
        yield args
        yield kwargs

    assert list(show(1, ('b', 2))) == [(1, ('b', 2)), {}]
    assert list(show(1, b=2)) == [(1,), {'b': 2}]
    assert len(calls) == 2
