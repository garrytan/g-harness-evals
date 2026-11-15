from unittest import TestCase

import more_itertools as mi


class ArgMinArgMaxOptionTests(TestCase):
    def test_default(self):
        self.assertIsNone(mi.argmin([], default=None))
        self.assertEqual(mi.argmax([], default=-1), -1)
        self.assertEqual(mi.argmin([2, 1, 3], default=-1), 1)
        with self.assertRaises(ValueError):
            mi.argmax([])

    def test_last(self):
        self.assertEqual(mi.argmax([1, 3, 3, 2], last=True), 2)
        self.assertEqual(mi.argmax([1, 3, 3, 2]), 1)
        self.assertEqual(mi.argmin([2, 1, 3], last=True), 1)
        self.assertEqual(mi.argmax(['a', 'bb', 'cc'], key=len, last=True), 2)

    def test_last_with_ties(self):
        self.assertEqual(mi.argmin([3, 1, 2, 1], last=True), 3)
        self.assertEqual(mi.argmin([3, 1, 2, 1]), 1)
        self.assertEqual(mi.argmin(['bb', 'a', 'c'], key=len, last=True), 2)

    def test_several_arguments(self):
        self.assertEqual(mi.argmin(4, 1, 1, last=True), 2)
        self.assertEqual(mi.argmax(7, 7, last=True), 1)
        self.assertEqual(mi.argmax(7, 7), 0)
