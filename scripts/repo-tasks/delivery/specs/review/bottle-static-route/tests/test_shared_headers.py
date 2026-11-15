import io
import os

import bottle


def site(tmp_path):
    root = tmp_path / 'pub'
    for name, text in [('a.txt', 'file a'), ('index.html', 'home'), ('sub/index.html', 'sub home'),
                       ('.git/config', '[core]'), ('.env', 'SECRET=1')]:
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_text(text)
    (tmp_path / 'secret.txt').write_text('top secret')
    return root


def get(app, path, query='', script_name=''):
    env = {'REQUEST_METHOD': 'GET', 'PATH_INFO': path, 'SCRIPT_NAME': script_name, 'QUERY_STRING': query,
           'SERVER_NAME': 'localhost', 'SERVER_PORT': '80', 'SERVER_PROTOCOL': 'HTTP/1.1',
           'wsgi.url_scheme': 'http', 'wsgi.input': io.BytesIO(), 'wsgi.errors': io.StringIO()}
    out = {}

    def start_response(status, headers, exc_info=None):
        out['status'] = int(status.split()[0])
        out['headers'] = dict(headers)

    body = app(env, start_response)
    try:
        data = b''.join(body)
    finally:
        if hasattr(body, 'close'):
            body.close()
    return out['status'], out['headers'], data


def test_index_headers_do_not_leak_into_file_responses(tmp_path):
    extra = {'X-Frame-Options': 'DENY'}
    app = bottle.Bottle()
    app.static('/s/', str(site(tmp_path)), headers=extra)
    assert get(app, '/s/')[1]['Cache-Control'] == 'no-cache'
    status, headers, body = get(app, '/s/a.txt')
    assert body == b'file a'
    assert headers['X-Frame-Options'] == 'DENY'
    assert 'Cache-Control' not in headers
    assert extra == {'X-Frame-Options': 'DENY'}
