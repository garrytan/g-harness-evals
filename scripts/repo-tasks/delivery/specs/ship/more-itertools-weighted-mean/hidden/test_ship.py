import pytest

from more_itertools import dotproduct, polynomial_eval, sum_of_squares, weighted_mean


@pytest.mark.parametrize('values, weights, expected', [
    ([1, 2, 3], [3, 0, 1], 1.5),
    ([10, 20], [1, 1], 15.0),
    ([5], [2], 5.0),
    ([1.5, 2.5], [1, 3], 2.25),
    ([4, 8, 6], [0, 0, 2], 6.0),
])
def test_weighted(values, weights, expected):
    result = weighted_mean(values, weights)
    assert result == expected
    assert isinstance(result, float)


def test_without_weights():
    assert weighted_mean([1, 2, 3, 4]) == 2.5
    assert weighted_mean([7]) == 7.0
    assert weighted_mean((2, 4)) == 3.0


@pytest.mark.parametrize('values, weights', [
    ([1, 2, 3], [1, 1]),
    ([1, 2], [1, 1, 1]),
    ([], [1]),
])
def test_lengths_must_match(values, weights):
    with pytest.raises(ValueError):
        weighted_mean(values, weights)


@pytest.mark.parametrize('weights', [[2, -1, 2], [-1, 3, 0], [0, 0, -1]])
def test_negative_weights(weights):
    with pytest.raises(ValueError):
        weighted_mean([1, 2, 3], weights)


@pytest.mark.parametrize('values, weights', [([1, 2], [0, 0]), ([], []), ([], None)])
def test_weights_adding_up_to_zero(values, weights):
    with pytest.raises(ValueError):
        weighted_mean(values, weights)


def test_main_dotproduct_still_works():
    assert dotproduct([1, 2], [3, 4]) == 11
    with pytest.raises(ValueError):
        dotproduct([1, 2], [3])
    assert sum_of_squares([1, 2, 3]) == 14
    assert polynomial_eval([1, -4, -17, 60], 2) == 18
