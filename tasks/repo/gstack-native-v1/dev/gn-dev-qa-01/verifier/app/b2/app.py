import argparse
import html
import json
import re
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

DB = None


def connect():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def shifts(c):
    return [dict(r) for r in c.execute('''SELECT s.*, COUNT(v.id) AS booked,
        s.capacity - COUNT(v.id) AS slots FROM shifts s
        LEFT JOIN volunteers v ON v.shift_id=s.id GROUP BY s.id ORDER BY s.id''')]


def page(title, body, script=''):
    return ('<!doctype html><html lang="en"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width">'
            '<title>' + html.escape(title) + '</title>'
            '<style>body{font:18px sans-serif;max-width:800px;margin:2em auto;padding:1em}'
            'label{display:block;margin:1em 0}input,button{font:inherit}'
            'li{margin:1em 0}#error{color:#a00}</style>'
            '<nav><a href="/">Shifts</a> | <a href="/new">Create shift</a></nav>'
            '<h1>' + html.escape(title) + '</h1>' + body +
            '<script>' + script + '</script></html>')


FORM_JS = '''
const form = document.querySelector('form');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  for (const key of ['capacity', 'hours']) {
    if (key in data) data[key] = Number(data[key]);
  }
  try {
    const response = await fetch(form.action, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    location.href = form.dataset.destination || '/';
  } catch (error) {
    document.querySelector('#error').textContent = error.message;
    button.disabled = false;
  }
});
'''

NEW_JS = '''
const capacity = document.querySelector('[name=capacity]');
const hours = document.querySelector('[name=hours]');
function preview() {
  const total = Number(capacity.value) * Number(hours.value);
  document.querySelector('#total').textContent = String(total);
}
capacity.addEventListener('input', preview);
hours.addEventListener('input', preview);
preview();
'''


class Handler(BaseHTTPRequestHandler):
    def send(self, status, value, kind='application/json'):
        raw = (json.dumps(value) if kind == 'application/json' else value).encode()
        self.send_response(status)
        self.send_header('Content-Type', kind + '; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def error(self, status, message):
        self.send(status, {'error': message})

    def do_GET(self):
        url = urlsplit(self.path)
        with connect() as c:
            rows = shifts(c)
        if url.path == '/api/shifts':
            self.send(200, {'shifts': rows})
        elif url.path == '/':
            items = ''.join(
                '<li><strong>' + html.escape(s['title']) + '</strong> — '
                + str(s['hours']) + ' hours; ' + str(s['slots']) + ' of '
                + str(s['capacity']) + ' places available. '
                + '<a href="/signup?id=' + str(s['id']) + '">Sign up</a></li>'
                for s in rows)
            self.send(200, page('Volunteer shifts', '<ul>' + items + '</ul>'
                      if rows else '<p>No shifts yet. Create one to begin.</p>'), 'text/html')
        elif url.path == '/new':
            body = '''<form action="/api/shifts" method="post">
<label>Title <input name="title" required maxlength="80"></label>
<label>Places <input name="capacity" type="number" min="1" max="12" step="1" value="2" required></label>
<label>Hours <input name="hours" type="number" min="1" max="8" step="1" value="3" required></label>
<p>Total person-hours: <output id="total"></output></p>
<button>Create shift</button><p id="error" role="alert"></p></form>'''
            self.send(200, page('Create shift', body, FORM_JS + NEW_JS), 'text/html')
        elif url.path == '/signup':
            query = parse_qs(url.query)
            try:
                ident = int(query.get('id', [''])[0])
            except ValueError:
                self.error(404, 'Shift not found')
                return
            shift = next((s for s in rows if s['id'] == ident), None)
            if shift is None:
                self.error(404, 'Shift not found')
                return
            body = ('<p>' + str(shift['slots']) + ' places available; '
                    + str(shift['hours']) + ' hours.</p>'
                    + '<form method="post" action="/api/shifts/' + str(ident) + '/signups">'
                    + '<label>Name <input name="name" required maxlength="60"></label>'
                    + '<label>Email <input name="email" type="email" required maxlength="120"></label>'
                    + '<button>Sign up</button><p id="error" role="alert"></p></form>')
            self.send(200, page('Sign up: ' + shift['title'], body, FORM_JS), 'text/html')
        else:
            self.error(404, 'Not found')

    def do_POST(self):
        path = urlsplit(self.path).path
        match = re.fullmatch(r'/api/shifts/([1-9][0-9]*)/signups', path)
        if path != '/api/shifts' and match is None:
            self.error(404, 'Not found')
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 16384:
                self.error(400, 'Invalid JSON body')
                return
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError()
        except (ValueError, UnicodeError):
            self.error(400, 'Invalid JSON body')
            return
        if path == '/api/shifts':
            title = data.get('title')
            capacity, hours = data.get('capacity'), data.get('hours')
            if not isinstance(title, str) or not 1 <= len(title.strip()) <= 80:
                self.error(422, 'Invalid title')
                return
            if type(capacity) is not int or not 1 <= capacity <= 13:
                self.error(422, 'Invalid capacity')
                return
            if type(hours) is not int or not 1 <= hours <= 8:
                self.error(422, 'Invalid hours')
                return
            with connect() as c:
                ident = c.execute('INSERT INTO shifts(title,capacity,hours) VALUES(?,?,?)',
                                  (title.strip(), capacity, hours)).lastrowid
            self.send(201, {'id': ident})
            return
        name, email = data.get('name'), data.get('email')
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 60:
            self.error(422, 'Invalid name')
            return
        if (not isinstance(email, str) or len(email.strip()) > 120
                or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email.strip())):
            self.error(422, 'Invalid email')
            return
        ident = int(match[1])
        with connect() as c:
            c.execute('BEGIN IMMEDIATE')
            shift = c.execute('SELECT * FROM shifts WHERE id=?', (ident,)).fetchone()
            if shift is None:
                self.error(404, 'Shift not found')
                return
            duplicate = c.execute('SELECT id FROM volunteers WHERE shift_id=? AND email=? COLLATE NOCASE',
                                  (ident, email.strip())).fetchone()
            if duplicate:
                self.error(409, 'Email already signed up')
                return
            count = c.execute('SELECT COUNT(*) FROM volunteers WHERE shift_id=?', (ident,)).fetchone()[0]
            if count >= shift['capacity']:
                self.error(409, 'Shift full')
                return
            signup = c.execute('INSERT INTO volunteers(shift_id,name,email) VALUES(?,?,?)',
                               (ident, name.strip(), email.strip())).lastrowid
        self.send(201, {'id': signup, 'shift_id': ident})


def main():
    global DB
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--data', type=Path, required=True)
    args = parser.parse_args()
    args.data.mkdir(parents=True, exist_ok=True)
    DB = args.data / 'volunteers.sqlite3'
    with connect() as c:
        c.executescript('''CREATE TABLE IF NOT EXISTS shifts (
            id INTEGER PRIMARY KEY, title TEXT NOT NULL, capacity INTEGER NOT NULL, hours INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS volunteers (
            id INTEGER PRIMARY KEY, shift_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL);''')
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
