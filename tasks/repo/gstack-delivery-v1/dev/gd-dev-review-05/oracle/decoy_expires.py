import time
from datetime import datetime, timedelta, timezone

import bottle


def signed(name, value, **options):
    res = bottle.BaseResponse()
    res.set_cookie(name, value, **options)
    return [v.split(';')[0].split('=', 1)[1] for k, v in res.headerlist if k == 'Set-Cookie'][0]


def read(header, name, default=None, **options):
    return bottle.BaseRequest({'HTTP_COOKIE': header}).get_cookie(name, default, **options)


def test_expires_is_signed_into_the_cookie():
    now = datetime.now(timezone.utc)
    for when, expected in ((now + timedelta(days=1), 'v'), (now - timedelta(days=1), None),
                           (int(time.time()) + 3600, 'v'), (int(time.time()) - 3600, None)):
        value = signed('k', 'v', secret='s3cret', expires=when)
        assert read('k=' + value, 'k', secret='s3cret') == expected
