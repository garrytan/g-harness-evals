import bottle
from bottle import best_match


def test_highest_quality_wins():
    assert best_match('text/html;q=0.5, application/json', ['text/html', 'application/json']) == 'application/json'


def test_wildcards():
    assert best_match('*/*', ['text/html', 'text/plain']) == 'text/html'
    assert best_match('text/*', ['application/json', 'text/plain']) == 'text/plain'


def test_nothing_acceptable():
    assert best_match('image/png', ['text/html']) is None
    assert best_match('image/png', ['text/html'], 'text/plain') == 'text/plain'


def test_missing_header():
    assert best_match(None, ['text/html', 'text/plain']) == 'text/html'
    assert best_match('', [], 'text/plain') == 'text/plain'


def test_case_is_ignored():
    assert best_match('TEXT/HTML', ['text/html']) == 'text/html'


def test_request_method():
    request = bottle.BaseRequest({'HTTP_ACCEPT': 'application/json'})
    assert request.best_match(['text/html', 'application/json']) == 'application/json'
