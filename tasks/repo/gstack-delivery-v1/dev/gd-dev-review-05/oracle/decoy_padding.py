import bottle


def signed(name, value, **options):
    res = bottle.BaseResponse()
    res.set_cookie(name, value, **options)
    return [v.split(';')[0].split('=', 1)[1] for k, v in res.headerlist if k == 'Set-Cookie'][0]


def read(header, name, default=None, **options):
    return bottle.BaseRequest({'HTTP_COOKIE': header}).get_cookie(name, default, **options)


def test_values_of_every_padding_length_round_trip():
    for data in ['', 'a', 'ab', 'abc', 'abcd', 'abcde', {'n': [1, 2, 3]}, 12]:
        value = signed('k', data, secret='s3cret')
        assert '=' not in value
        assert read('k=' + value, 'k', secret='s3cret') == data
