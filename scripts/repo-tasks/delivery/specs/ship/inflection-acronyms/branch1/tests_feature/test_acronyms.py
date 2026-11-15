import pytest

import inflection


@pytest.fixture(autouse=True)
def acronyms():
    saved = dict(inflection.ACRONYMS)
    for word in ("API", "SSL", "PhD"):
        inflection.acronym(word)
    yield
    inflection.ACRONYMS.clear()
    inflection.ACRONYMS.update(saved)


def test_camelize():
    assert inflection.camelize("api_key") == "APIKey"
    assert inflection.camelize("my_api") == "MyAPI"
    assert inflection.camelize("phd_thesis") == "PhDThesis"


def test_camelize_lower_without_acronym():
    assert inflection.camelize("device_type", False) == "deviceType"


def test_underscore():
    assert inflection.underscore("APIKey") == "api_key"
    assert inflection.underscore("MyPhDThesis") == "my_phd_thesis"


def test_humanize():
    assert inflection.humanize("ssl_error") == "SSL error"
    assert inflection.humanize("api_key_id") == "API key"


def test_titleize():
    assert inflection.titleize("api_key") == "API Key"
    assert inflection.titleize("my_phd_thesis") == "My PhD Thesis"
