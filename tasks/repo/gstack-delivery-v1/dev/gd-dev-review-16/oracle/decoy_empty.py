from more_itertools import iter_ranges


def test_empty_parts_are_skipped():
    assert list(iter_ranges('1,,2,')) == [1, 2]
    assert list(iter_ranges(' , ')) == []
