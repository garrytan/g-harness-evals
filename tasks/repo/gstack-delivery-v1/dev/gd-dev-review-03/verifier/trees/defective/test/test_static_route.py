import os
import shutil
import tempfile

from .tools import ServerTestBase


class TestStaticRoute(ServerTestBase):
    def setUp(self):
        ServerTestBase.setUp(self)
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root)
        self.write('a.txt', 'file a')
        self.write('index.html', 'home')
        self.write('docs/index.html', 'docs home')
        self.write('.env', 'SECRET=1')

    def write(self, name, text):
        path = os.path.join(self.root, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as fp:
            fp.write(text)

    def test_file(self):
        self.app.static('/static/', self.root)
        self.assertBody('file a', '/static/a.txt')
        self.assertHeader('Content-Type', 'text/plain; charset=UTF-8', '/static/a.txt')
        self.assertStatus(404, '/static/b.txt')

    def test_prefix_without_slashes(self):
        self.app.static('static', self.root)
        self.assertBody('file a', '/static/a.txt')

    def test_index(self):
        self.app.static('/static/', self.root)
        self.assertBody('home', '/static/')
        self.assertBody('docs home', '/static/docs/')
        self.assertHeader('Cache-Control', 'no-cache', '/static/docs/')

    def test_no_index(self):
        self.app.static('/static/', self.root, index=None)
        self.assertStatus(404, '/static/')
        self.assertStatus(404, '/static/docs/')

    def test_directory_redirect(self):
        self.app.static('/static/', self.root)
        result = self.urlopen('/static/docs')
        self.assertIn(result['code'], (302, 303))
        self.assertTrue(result['header']['Location'].endswith('/static/docs/'))

    def test_hidden_file(self):
        self.app.static('/static/', self.root)
        self.assertStatus(404, '/static/.env')

    def test_cache_max_age(self):
        self.app.static('/static/', self.root, cache_max_age=60)
        self.assertHeader('Cache-Control', 'max-age=60', '/static/a.txt')

    def test_options(self):
        self.app.static('/static/', self.root, download=True)
        self.assertHeader('Content-Disposition', 'attachment; filename="a.txt"', '/static/a.txt')

    def test_missing_root(self):
        self.assertRaises(ValueError, self.app.static, '/static/', os.path.join(self.root, 'nope'))
