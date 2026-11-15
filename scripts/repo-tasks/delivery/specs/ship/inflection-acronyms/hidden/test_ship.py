import pytest

import inflection


def _register():
    for word in ("API", "SSL", "PhD", "HTTP", "HTTPS"):
        inflection.acronym(word)


@pytest.mark.parametrize(("word", "expected"), [
    ("api_key", "APIKey"),
    ("my_api", "MyAPI"),
    ("ssl_phd", "SSLPhD"),
    ("API_key", "APIKey"),
    ("Api_KEY", "APIKey"),
    ("phd_thesis", "PhDThesis"),
    ("https_proxy", "HTTPSProxy"),
    ("rapid_fire", "RapidFire"),
    ("device_TYPE", "DeviceType"),
])
def test_camelize(word, expected):
    _register()
    assert inflection.camelize(word) == expected


@pytest.mark.parametrize(("word", "expected"), [
    ("api_key", "apiKey"),
    ("ssl_phd", "sslPhD"),
    ("phd_thesis", "phdThesis"),
    ("my_api", "myAPI"),
    ("device_type", "deviceType"),
    ("Capital", "capital"),
])
def test_camelize_lower(word, expected):
    _register()
    assert inflection.camelize(word, False) == expected


@pytest.mark.parametrize(("word", "expected"), [
    ("APIKey", "api_key"),
    ("MyAPIKey", "my_api_key"),
    ("PhDThesis", "phd_thesis"),
    ("MyPhDThesis", "my_phd_thesis"),
    ("HTTPSProxy", "https_proxy"),
    ("HTTPProxy", "http_proxy"),
    ("SSLError", "ssl_error"),
    ("HTMLTidy", "html_tidy"),
])
def test_underscore(word, expected):
    _register()
    assert inflection.underscore(word) == expected


@pytest.mark.parametrize(("word", "expected"), [
    ("ssl_error", "SSL error"),
    ("api_key_id", "API key"),
    ("phd", "PhD"),
    ("employee_salary", "Employee salary"),
])
def test_humanize(word, expected):
    _register()
    assert inflection.humanize(word) == expected


@pytest.mark.parametrize(("word", "expected"), [
    ("api_key", "API Key"),
    ("SSLError", "SSL Error"),
    ("my_phd_thesis", "My PhD Thesis"),
    ("david's code", "David's Code"),
])
def test_titleize(word, expected):
    _register()
    assert inflection.titleize(word) == expected


def test_main_camelize_change_still_works():
    assert inflection.camelize("DEVICE_type") == "DeviceType"
    assert inflection.camelize("Camel_Case") == "CamelCase"
