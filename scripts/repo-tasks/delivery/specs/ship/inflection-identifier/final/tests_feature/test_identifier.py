import pytest

import inflection


@pytest.mark.parametrize(("text", "expected"), [
    ("Ship date (UTC)", "ship_date_utc"),
    ("ShipDate", "ship_date"),
    ("  --total--  ", "total"),
    ("Café crème", "cafe_creme"),
    ("2nd address", "_2nd_address"),
    ("class", "class_"),
])
def test_snake_case(text, expected):
    assert inflection.to_identifier(text) == expected


@pytest.mark.parametrize(("text", "expected"), [
    ("ship date", "ShipDate"),
    ("HTTP server", "HttpServer"),
])
def test_camel_case(text, expected):
    assert inflection.to_identifier(text, camel=True) == expected


def test_no_letters_or_digits():
    with pytest.raises(ValueError):
        inflection.to_identifier("!!!")


def test_characters_without_ascii_form_are_dropped():
    assert inflection.to_identifier("Ærøskøbing") == "rskbing"


def test_apostrophes_are_removed():
    assert inflection.to_identifier("Don't panic") == "dont_panic"


def test_camel_case_keywords():
    assert inflection.to_identifier("none", camel=True) == "None_"
    assert inflection.to_identifier("class", camel=True) == "Class"
