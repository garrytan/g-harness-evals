import base64

import bottle


def signed(name, value, **options):
    res = bottle.BaseResponse()
    res.set_cookie(name, value, **options)
    return [v.split(';')[0].split('=', 1)[1] for k, v in res.headerlist if k == 'Set-Cookie'][0]


def read(header, name, default=None, **options):
    return bottle.BaseRequest({'HTTP_COOKIE': header}).get_cookie(name, default, **options)


def test_a_forged_payload_gives_the_default():
    payload = base64.urlsafe_b64encode(b'5').decode().rstrip('=')
    assert read('session=j1.%s.forged' % payload, 'session', 'anon', secret='s3cret') == 'anon'
