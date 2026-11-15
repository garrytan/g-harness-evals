import bottle


def signed(name, value, **options):
    res = bottle.BaseResponse()
    res.set_cookie(name, value, **options)
    return [v.split(';')[0].split('=', 1)[1] for k, v in res.headerlist if k == 'Set-Cookie'][0]


def read(header, name, default=None, **options):
    return bottle.BaseRequest({'HTTP_COOKIE': header}).get_cookie(name, default, **options)


def test_the_first_secret_signs():
    value = signed('k', 'v', secret=['new', 'old'])
    assert read('k=' + value, 'k', secret='new') == 'v'
