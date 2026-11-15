from datetime import timedelta

import bottle


def signed(name, value, **options):
    res = bottle.BaseResponse()
    res.set_cookie(name, value, **options)
    return [v.split(';')[0].split('=', 1)[1] for k, v in res.headerlist if k == 'Set-Cookie'][0]


def read(header, name, default=None, **options):
    return bottle.BaseRequest({'HTTP_COOKIE': header}).get_cookie(name, default, **options)


def test_max_age_as_a_timedelta_of_whole_days():
    value = signed('k', 'v', secret='s3cret', max_age=timedelta(days=2))
    assert read('k=' + value, 'k', secret='s3cret') == 'v'
