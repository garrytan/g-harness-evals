import io

import bottle


def get(app, path):
    env = {'REQUEST_METHOD': 'GET', 'PATH_INFO': path, 'SCRIPT_NAME': '', 'QUERY_STRING': '',
           'SERVER_NAME': 'localhost', 'SERVER_PORT': '80', 'SERVER_PROTOCOL': 'HTTP/1.1',
           'wsgi.url_scheme': 'http', 'wsgi.input': io.BytesIO(), 'wsgi.errors': io.StringIO()}
    out = {}

    def start_response(status, headers, exc_info=None):
        out['status'] = int(status.split()[0])

    body = app(env, start_response)
    try:
        data = b''.join(body)
    finally:
        if hasattr(body, 'close'):
            body.close()
    return out['status'], data


def test_static_file_refuses_a_sibling_directory_that_shares_the_root_prefix(tmp_path):
    (tmp_path / 'pub').mkdir()
    (tmp_path / 'pub' / 'a.txt').write_text('file a')
    (tmp_path / 'pub-private').mkdir()
    (tmp_path / 'pub-private' / 'key.txt').write_text('private key')
    root = str(tmp_path / 'pub')
    app = bottle.Bottle()
    app.route('/f/<name:path>', callback=lambda name: bottle.static_file(name, root))
    assert get(app, '/f/a.txt') == (200, b'file a')
    status, body = get(app, '/f/../pub-private/key.txt')
    assert status == 403
    assert b'private key' not in body
