import pytest

import bottle


@pytest.mark.parametrize("header, offers, expected", [
    ("text/html;q=0.5, application/json", ["text/html", "application/json"], "application/json"),
    ("application/json, text/html", ["text/html", "application/json"], "text/html"),
    ("text/*;q=0.5, text/html;q=0.1", ["text/html", "text/plain"], "text/plain"),
    ("*/*;q=0.9, text/html;q=0.2", ["text/html", "image/png"], "image/png"),
    ("text/*;q=0.3, */*;q=0.8, text/plain;q=0.6", ["text/plain", "text/csv", "image/png"], "image/png"),
    ("text/*;q=0.3, */*;q=0.1", ["image/png", "text/csv"], "text/csv"),
    ("text/html;level=1;q=0.4, text/*;q=0.9", ["text/html", "text/css"], "text/css"),
])
def test_most_specific_range_sets_the_quality(header, offers, expected):
    assert bottle.best_match(header, offers) == expected


@pytest.mark.parametrize("header, offers, default, expected", [
    ("text/html;q=0, */*", ["text/html"], None, None),
    ("text/html;q=0, */*", ["text/html", "text/plain"], None, "text/plain"),
    ("text/*;q=0, */*;q=1", ["text/plain"], "x/y", "x/y"),
    ("image/png", ["text/html"], None, None),
    ("image/png", ["text/html"], "text/plain", "text/plain"),
    ("text/html;q=abc", ["text/html"], "d/d", "d/d"),
])
def test_quality_zero_is_never_returned(header, offers, default, expected):
    assert bottle.best_match(header, offers, default) == expected


def test_ties_and_case():
    assert bottle.best_match("text/html, application/json", ["application/json", "text/html"]) == "application/json"
    assert bottle.best_match("*/*", ["Application/JSON", "text/html"]) == "Application/JSON"
    assert bottle.best_match("TEXT/HTML;Q=0.5, text/plain;q=0.4", ["text/plain", "text/html"]) == "text/html"
    assert bottle.best_match("text/html;charset=utf-8", ["text/html"]) == "text/html"


def test_missing_or_empty_header():
    assert bottle.best_match(None, ["text/html", "text/plain"]) == "text/html"
    assert bottle.best_match("", ["application/json"]) == "application/json"
    assert bottle.best_match(None, [], "text/plain") == "text/plain"
    assert bottle.best_match("", []) is None


def test_main_header_parameters_are_ordered_pairs():
    assert bottle._parse_http_header("text/html; level=1; level=2; q=0.5") == [
        ("text/html", [("level", "1"), ("level", "2"), ("q", "0.5")])]
    assert bottle._parse_http_header('form-data; name="a"; filename="b.txt"') == [
        ("form-data", [("name", "a"), ("filename", "b.txt")])]


def test_main_link_header():
    assert bottle.parse_link_header('<https://x.test/2>; rel="next"; title="Page 2", <https://x.test/9>; rel=last') == [
        ("https://x.test/2", [("rel", "next"), ("title", "Page 2")]), ("https://x.test/9", [("rel", "last")])]
    assert bottle.parse_link_header("<https://x.test/a>; rel=prev; rel=up") == [
        ("https://x.test/a", [("rel", "prev"), ("rel", "up")])]
