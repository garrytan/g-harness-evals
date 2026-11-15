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


def test_directory_redirect_keeps_the_mount_path(tmp_path):
    app = bottle.Bottle()
    app.static('/s/', str(site(tmp_path)))
    status, headers, body = get(app, '/s/sub', script_name='/app')
    assert status in (301, 302, 303, 307, 308)
    assert headers['Location'] == 'http://localhost/app/s/sub/'
