from unittest import TestCase

from more_itertools import replayable


class ReplayableTests(TestCase):
    def test_replays_without_calling_again(self):
        calls = []

        @replayable
        def numbers(n):
            calls.append(n)
            yield from range(n)

        self.assertEqual(list(numbers(3)), [0, 1, 2])
        self.assertEqual(list(numbers(3)), [0, 1, 2])
        self.assertEqual(calls, [3])

    def test_arguments_are_recorded_separately(self):
        calls = []

        @replayable
        def pair(a, b=0):
            calls.append((a, b))
            yield a
            yield b

        self.assertEqual(list(pair(1, 2)), [1, 2])
        self.assertEqual(list(pair(1, b=2)), [1, 2])
        self.assertEqual(list(pair(2)), [2, 0])
        self.assertEqual(list(pair(1, 2)), [1, 2])
        self.assertEqual(len(calls), 3)

    def test_unhashable_arguments(self):
        @replayable
        def items(values):
            yield from values

        self.assertEqual(list(items([1, 2])), [1, 2])
        self.assertEqual(list(items([1, 2])), [1, 2])
        self.assertEqual(items.cache_info(), (0, 0, 0))

    def test_maxsize(self):
        @replayable(maxsize=2)
        def numbers(n):
            yield from range(n)

        for n in [1, 2, 3, 1, 2, 3]:
            self.assertEqual(list(numbers(n)), list(range(n)))
        hits, misses, currsize = numbers.cache_info()
        self.assertEqual(hits + misses, 6)
        self.assertLessEqual(currsize, 2)

    def test_cache_clear(self):
        calls = []

        @replayable
        def numbers(n):
            calls.append(n)
            yield from range(n)

        list(numbers(2))
        list(numbers(2))
        self.assertEqual(numbers.cache_info(), (1, 1, 1))
        numbers.cache_clear()
        self.assertEqual(numbers.cache_info(), (0, 0, 0))
        list(numbers(2))
        self.assertEqual(calls, [2, 2])

    def test_keeps_the_name(self):
        @replayable
        def numbers():
            "Some numbers."
            yield 1

        self.assertEqual(numbers.__name__, 'numbers')
        self.assertEqual(numbers.__doc__, 'Some numbers.')
