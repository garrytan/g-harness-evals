import pytest

import inflection


@pytest.fixture(autouse=True)
def restore_rules():
    plurals = list(inflection.PLURALS)
    singulars = list(inflection.SINGULARS)
    uncountables = set(inflection.UNCOUNTABLES)
    yield
    inflection.PLURALS[:] = plurals
    inflection.SINGULARS[:] = singulars
    inflection.UNCOUNTABLES.clear()
    inflection.UNCOUNTABLES.update(uncountables)


def test_plural_rule():
    inflection.plural(r"(?i)(cact)us$", r"\1i")
    assert inflection.pluralize("cactus") == "cacti"


def test_singular_rule():
    inflection.singular(r"(?i)(cact)i$", r"\1us")
    assert inflection.singularize("cacti") == "cactus"


def test_new_rules_come_first():
    inflection.plural(r"(?i)(ox)$", r"\1es")
    assert inflection.pluralize("ox") == "oxes"


def test_irregular():
    inflection.irregular("octopus", "octopuses")
    assert inflection.pluralize("octopus") == "octopuses"
    assert inflection.pluralize("Octopus") == "Octopuses"
    assert inflection.singularize("octopuses") == "octopus"


def test_uncountable():
    inflection.uncountable("police")
    assert inflection.pluralize("police") == "police"
    assert inflection.singularize("police") == "police"


def test_builtin_irregulars():
    assert inflection.pluralize("person") == "people"
    assert inflection.singularize("children") == "child"
