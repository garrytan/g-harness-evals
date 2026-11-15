import bottle


def signed(name, value, **options):
    res = bottle.BaseResponse()
    res.set_cookie(name, value, **options)
    return [v.split(';')[0].split('=', 1)[1] for k, v in res.headerlist if k == 'Set-Cookie'][0]


def read(header, name, default=None, **options):
    return bottle.BaseRequest({'HTTP_COOKIE': header}).get_cookie(name, default, **options)


def test_an_unsigned_cookie_is_not_accepted_as_signed():
    assert read('user=admin', 'user', secret='s3cret') is None
    assert read('user=admin', 'user', 'guest', secret='s3cret') == 'guest'
