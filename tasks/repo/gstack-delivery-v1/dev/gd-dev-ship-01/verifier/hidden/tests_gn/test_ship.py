import pytest

import inflection


def test_plural_rule_comes_before_builtin_rules():
    inflection.plural(r"(?i)(cact)us$", r"\1i")
    assert inflection.pluralize("cactus") == "cacti"
    assert inflection.pluralize("Cactus") == "Cacti"


def test_newest_rule_wins():
    inflection.plural(r"(?i)(formul)a$", r"\1as")
    inflection.plural(r"(?i)(formul)a$", r"\1ae")
    assert inflection.pluralize("formula") == "formulae"


def test_singular_rule():
    inflection.singular(r"(?i)(alumn)i$", r"\1us")
    assert inflection.singularize("alumni") == "alumnus"
    assert inflection.singularize("Alumni") == "Alumnus"


def test_irregular_both_directions():
    inflection.irregular("octopus", "octopuses")
    assert inflection.pluralize("octopus") == "octopuses"
    assert inflection.pluralize("Octopus") == "Octopuses"
    assert inflection.pluralize("octopuses") == "octopuses"
    assert inflection.singularize("octopuses") == "octopus"


def test_irregular_word_is_no_longer_uncountable():
    inflection.irregular("fish", "fishes")
    assert inflection.pluralize("fish") == "fishes"
    assert inflection.singularize("fishes") == "fish"
    inflection.irregular("Sheep", "Sheeple")
    assert inflection.pluralize("sheep") == "sheeple"


@pytest.mark.parametrize("word", ["police", "Police", "POLICE"])
def test_uncountable_in_any_case(word):
    inflection.uncountable("Police")
    assert inflection.pluralize(word) == word
    assert inflection.singularize(word) == word


def test_several_uncountables():
    inflection.uncountable("Bison", "moose")
    assert inflection.pluralize("bison") == "bison"
    assert inflection.pluralize("Moose") == "Moose"
    assert inflection.singularize("bison") == "bison"


def test_builtin_rules_after_merge():
    assert inflection.pluralize("goose") == "geese"
    assert inflection.singularize("Geese") == "Goose"
    assert inflection.pluralize("person") == "people"
    assert inflection.singularize("kine") == "cow"
    assert inflection.pluralize("quiz") == "quizzes"
