from unittest import TestCase

from more_itertools import weighted_mean


class WeightedMeanTests(TestCase):
    def test_weights(self):
        self.assertEqual(weighted_mean([1, 2, 3], [3, 0, 1]), 1.5)
        self.assertEqual(weighted_mean([10, 20], [1, 1]), 15.0)

    def test_no_weights(self):
        self.assertEqual(weighted_mean([1, 2, 3, 4]), 2.5)
        self.assertIsInstance(weighted_mean([2, 2]), float)

    def test_zero_weights(self):
        with self.assertRaises(ValueError):
            weighted_mean([1, 2], [0, 0])
        with self.assertRaises(ValueError):
            weighted_mean([])

    def test_negative_weights(self):
        with self.assertRaises(ValueError):
            weighted_mean([1, 2, 3], [2, -1, 2])

    def test_lengths_must_match(self):
        with self.assertRaises(ValueError):
            weighted_mean([1, 2, 3], [1, 1])
