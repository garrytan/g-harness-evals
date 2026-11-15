from more_itertools import iter_ranges


def test_a_range_of_one():
    assert list(iter_ranges('3-3')) == [3]
    assert list(iter_ranges('1,4-4,0-0')) == [1, 4, 0]
