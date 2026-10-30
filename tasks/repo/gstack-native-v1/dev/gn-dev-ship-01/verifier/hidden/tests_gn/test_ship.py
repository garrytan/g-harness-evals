import pytest

from inflection import parameterize


@pytest.mark.parametrize('preserve, expected', [
    (False, 'donald-e-knuth'),
    (True, 'Donald-E-Knuth'),
])
def test_case_option(preserve, expected):
    assert parameterize('Donald E. Knuth', preserve_case=preserve) == expected


@pytest.mark.parametrize('preserve, expected', [
    (False, 'helloXworld'),
    (True, 'HelloXWorld'),
])
def test_separator_case_survives(preserve, expected):
    assert parameterize(' Hello World! ', 'X', preserve) == expected


def test_default_preserves_separator_case():
    assert parameterize('Hello World', separator='X') == 'helloXworld'


def test_transliteration_and_empty_separator():
    assert parameterize('Ä Fine Day!', '', True) == 'AFineDay'
    assert parameterize('Ä Fine Day!', '', False) == 'afineday'


def test_empty_input():
    assert parameterize('', preserve_case=True) == ''
