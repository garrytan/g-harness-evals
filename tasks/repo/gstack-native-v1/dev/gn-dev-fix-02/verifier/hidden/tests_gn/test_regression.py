import pytest

from inflection import camelize


@pytest.mark.parametrize('word, expected', [
    ('device_type', 'deviceType'),
    ('account_status', 'accountStatus'),
    ('Device', 'device'),
    ('HTTPResponse', 'hTTPResponse'),
])
def test_camelize_none_flag_preserves_lower_camel_behavior(word, expected):
    assert camelize(word, uppercase_first_letter=None) == expected


def test_camelize_explicit_boolean_flags():
    assert camelize('device_type', True) == 'DeviceType'
    assert camelize('device_type', False) == 'deviceType'
