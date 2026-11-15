from unittest import TestCase

from more_itertools import shape


class ShapeTests(TestCase):
    def test_matrix(self):
        self.assertEqual(shape([[1, 2, 3], [4, 5, 6]]), (2, 3))
        self.assertEqual(shape([[[1, 2]], [[3, 4]]]), (2, 1, 2))

    def test_vector_and_scalar(self):
        self.assertEqual(shape([1, 2, 3]), (3,))
        self.assertEqual(shape(5), ())

    def test_strings_are_scalars(self):
        self.assertEqual(shape(['ab', 'cd']), (2,))
        self.assertEqual(shape([b'ab', b'cd']), (2,))
        self.assertEqual(shape('abc'), ())

    def test_ragged(self):
        with self.assertRaises(ValueError):
            shape([[1, 2], [3]])

    def test_empty(self):
        self.assertEqual(shape([]), (0,))
        self.assertEqual(shape([[], []]), (2, 0))

    def test_mixed(self):
        for tensor in ([[1, 2], 3], [1, [2, 3]], [[1], [[2]]]):
            with self.subTest(tensor=tensor):
                with self.assertRaises(ValueError):
                    shape(tensor)

    def test_mappings_are_scalars(self):
        self.assertEqual(shape([{'a': 1}, {'b': 2}]), (2,))
