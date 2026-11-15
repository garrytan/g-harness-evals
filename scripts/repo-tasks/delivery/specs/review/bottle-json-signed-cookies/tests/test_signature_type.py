import base64

import bottle


def read(header, name, default=None, **options):
    return bottle.BaseRequest({'HTTP_COOKIE': header}).get_cookie(name, default, **options)


def test_a_signature_with_an_escaped_non_ascii_character_gives_the_default():
    payload = base64.urlsafe_b64encode(b'["admin", null]').decode().rstrip('=')
    header = 'session="j1.%s.\\351forged"' % payload
    assert read(header, 'session', 'anon', secret='s3cret') == 'anon'
    assert read(header, 'session', 'anon', secret=['new', 'old']) == 'anon'
