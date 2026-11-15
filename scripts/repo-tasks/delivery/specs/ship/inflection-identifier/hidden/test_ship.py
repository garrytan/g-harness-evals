import pytest

import inflection


@pytest.mark.parametrize(("text", "expected"), [
    ("Ship date (UTC)", "ship_date_utc"),
    ("ShipDate", "ship_date"),
    ("HTTPServer port", "http_server_port"),
    ("  --total--  ", "total"),
    ("Café crème", "cafe_creme"),
    ("Ærøskøbing", "rskbing"),
    ("Aßlar", "alar"),
    ("Japanese: 日本語", "japanese"),
    ("Don't panic", "dont_panic"),
    ("it's", "its"),
    ("2nd address", "_2nd_address"),
    ("class", "class_"),
    ("none", "none"),
])
def test_snake_case(text, expected):
    assert inflection.to_identifier(text) == expected


@pytest.mark.parametrize(("text", "expected"), [
    ("ship date", "ShipDate"),
    ("Ærøskøbing havn", "RskbingHavn"),
    ("don't panic", "DontPanic"),
    ("2nd line", "_2ndLine"),
    ("3d", "_3d"),
    ("none", "None_"),
    ("true", "True_"),
    ("class", "Class"),
])
def test_camel_case(text, expected):
    assert inflection.to_identifier(text, camel=True) == expected


@pytest.mark.parametrize("text", ["", "!!!", "日本語", "'", "Æø"])
def test_no_letters_or_digits(text):
    with pytest.raises(ValueError):
        inflection.to_identifier(text)


def test_main_transliterate_still_works():
    assert inflection.transliterate("Ærøskøbing") == "?r?sk?bing"
    assert inflection.transliterate("Ærøskøbing", "") == "rskbing"
    assert inflection.transliterate("Malmö") == "Malmo"
    assert inflection.parameterize("Ærøskøbing") == "rskbing"
