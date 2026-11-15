from unittest import TestCase

from more_itertools import format_ranges, iter_ranges


class IterRangesTests(TestCase):
    def test_numbers_and_ranges(self):
        self.assertEqual(
            list(iter_ranges('1-3, 7, 10-12')), [1, 2, 3, 7, 10, 11, 12]
        )
        self.assertEqual(list(iter_ranges('42')), [42])
        self.assertEqual(list(iter_ranges('')), [])

    def test_spec_order_without_repeats(self):
        self.assertEqual(list(iter_ranges('5-7,1,6')), [5, 6, 7, 1])
        self.assertEqual(list(iter_ranges('2,2,1-2')), [2, 1])

    def test_invalid_specs(self):
        for spec in ['a', '1-', '-3', '1-2-3', '5-3', '1;2']:
            with self.subTest(spec=spec):
                with self.assertRaises(ValueError):
                    list(iter_ranges(spec))

    def test_limit(self):
        self.assertEqual(len(list(iter_ranges('1-10', limit=10))), 10)
        with self.assertRaises(ValueError):
            list(iter_ranges('1-20', limit=10))


class FormatRangesTests(TestCase):
    def test_runs(self):
        self.assertEqual(format_ranges([1, 2, 3, 7, 10, 11, 12]), '1-3,7,10-12')
        self.assertEqual(format_ranges([5]), '5')
        self.assertEqual(format_ranges([]), '')

    def test_any_order_and_repeats(self):
        self.assertEqual(format_ranges([3, 1, 2, 2, 1]), '1-3')
        self.assertEqual(format_ranges(range(20, 0, -1)), '1-20')

    def test_negative(self):
        with self.assertRaises(ValueError):
            format_ranges([1, -1])

    def test_round_trip(self):
        spec = '1-4,8,15-30,99'
        self.assertEqual(format_ranges(iter_ranges(spec)), spec)
