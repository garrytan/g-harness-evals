import bottle


def signed(name, value, **options):
    res = bottle.BaseResponse()
    res.set_cookie(name, value, **options)
    return [v.split(';')[0].split('=', 1)[1] for k, v in res.headerlist if k == 'Set-Cookie'][0]


def read(header, name, default=None, **options):
    return bottle.BaseRequest({'HTTP_COOKIE': header}).get_cookie(name, default, **options)


def test_a_signed_value_is_not_valid_under_another_name():
    value = signed('theme', 'admin', secret='s3cret')
    assert read('theme=' + value, 'theme', secret='s3cret') == 'admin'
    assert read('role=' + value, 'role', secret='s3cret') is None
