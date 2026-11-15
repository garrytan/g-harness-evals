from more_itertools import format_ranges


def test_two_consecutive_numbers_are_written_singly():
    assert format_ranges([9, 10]) == '9,10'
    assert format_ranges([1, 2, 5, 6, 7]) == '1,2,5-7'
