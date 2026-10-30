import argparse
import html
import json
import re
import sqlite3
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

CLASSES = [
    {'id': 1, 'title': 'Morning Yoga', 'time': 'Monday 09:00', 'price': 12, 'capacity': 8},
    {'id': 2, 'title': 'Strength Circuit', 'time': 'Tuesday 18:00', 'price': 18, 'capacity': 12},
]
DB = None


def valid_email(value):
    return len(value) <= 254 and re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', value) is not None


def page(title, body):
    return ('<!doctype html><html lang="en"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>' + html.escape(title) + '</title>'
            '<style>body{font:18px sans-serif;max-width:760px;margin:30px auto;padding:16px}'
            'label{display:block;margin:14px 0}input,button{font:inherit}li{margin:15px 0}</style>'
            '<nav><a href="/">Classes</a> | <a href="/lookup">My bookings</a></nav>'
            '<h1>' + html.escape(title) + '</h1>' + body + '</html>')


class Handler(BaseHTTPRequestHandler):
    def send(self, status, value, kind='application/json'):
        data = json.dumps(value).encode() if kind == 'application/json' else value.encode()
        self.send_response(status)
        self.send_header('Content-Type', kind + '; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def error(self, status, message):
        self.send(status, {'error': message})

    def do_GET(self):
        url = urlsplit(self.path)
        query = parse_qs(url.query, keep_blank_values=True)
        if url.path == '/api/classes':
            with closing(sqlite3.connect(DB)) as db:
                items = []
                for item in CLASSES:
                    used = db.execute('SELECT COALESCE(SUM(seats),0) FROM bookings WHERE class_id=?', (item['id'],)).fetchone()[0]
                    items.append(dict(item, remaining=item['capacity'] - used))
            self.send(200, {'classes': items})
        elif url.path == '/api/bookings':
            email = query.get('email', [''])[0]
            email = email.strip().lower()
            if not valid_email(email):
                return self.error(400, 'Invalid email')
            with closing(sqlite3.connect(DB)) as db:
                db.row_factory = sqlite3.Row
                rows = db.execute('SELECT * FROM bookings WHERE email=? ORDER BY id', (email,)).fetchall()
            self.send(200, {'bookings': [dict(row) for row in rows]})
        elif url.path == '/':
            cards = ''.join('<li data-title="' + html.escape(c['title'].lower()) + '">' +
                            html.escape(c['title']) + ' — ' + c['time'] + ' — $' + str(c['price']) +
                            ' per seat <a href="/book?id=' + str(c['id']) + '">Book</a></li>' for c in CLASSES)
            self.send(200, page('Gym classes', '''<form id="filter"><label>Filter classes
<input id="search" type="search"></label></form><ul>''' + cards + '''</ul>
<script>
const search = document.querySelector('#search');
document.querySelector('#filter').addEventListener('submit', e => e.preventDefault());
search.addEventListener('input', () => {
  document.querySelectorAll('li').forEach(li => li.hidden = !li.dataset.title.includes(search.value.toLowerCase()));
});
</script>'''), 'text/html')
        elif url.path == '/book':
            item = next((c for c in CLASSES if str(c['id']) == query.get('id', [''])[0]), None)
            if not item:
                return self.error(404, 'Class not found')
            body = '<p>' + html.escape(item['title']) + ' — ' + item['time'] + '</p>'
            body += '''<form id="booking">
<label>Name <input name="name" required maxlength="60"></label>
<label>Email <input name="email" type="email" required maxlength="254"></label>
<label>Seats <input id="seats" name="seats" type="number" min="1" max="4" value="1" required></label>
<p>Total: $<output id="total">''' + str(item['price']) + '''</output></p>
<button>Reserve seats</button></form><p id="message" role="status"></p>
<script>
const rate = ''' + str(item['price']) + ''';
const classId = ''' + str(item['id']) + ''';
const seats = document.querySelector('#seats');
seats.addEventListener('input', () => {
  document.querySelector('#total').textContent = Number(seats.value) * (rate + 1);
});
document.querySelector('#booking').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const response = await fetch('/api/bookings', {method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({class_id:classId, name:f.elements.name.value, email:f.elements.email.value, seats:Number(seats.value)})});
  const result = await response.json();
  document.querySelector('#message').textContent = response.ok ? 'Booked #' + result.id + ': $' + result.total : result.error;
});
</script>'''
            self.send(200, page('Book a class', body), 'text/html')
        elif url.path == '/lookup':
            self.send(200, page('My bookings', '''<form id="lookup">
<label>Email <input name="email" type="email" required maxlength="254"></label>
<button>Find bookings</button></form><p id="message" role="status"></p><ul id="results"></ul>
<script>
document.querySelector('#lookup').addEventListener('submit', async e => {
  e.preventDefault();
  const response = await fetch('/api/bookings?email=' + encodeURIComponent(e.target.elements.email.value));
  const result = await response.json();
  const list = document.querySelector('#results');
  list.replaceChildren();
  document.querySelector('#message').textContent = response.ok ? result.bookings.length + ' booking(s)' : result.error;
  if (response.ok) result.bookings.forEach(b => {
    const li = document.createElement('li');
    li.textContent = '#' + b.id + ' — Class ' + b.class_id + ' — ' + b.seats + ' seat(s) — $' + b.total;
    list.appendChild(li);
  });
});
</script>'''), 'text/html')
        else:
            self.error(404, 'Not found')

    def do_POST(self):
        if urlsplit(self.path).path != '/api/bookings':
            return self.error(404, 'Not found')
        if self.headers.get('Content-Type', '').split(';')[0].strip().lower() != 'application/json':
            return self.error(415, 'Expected application/json')
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 1 <= size <= 4096:
                return self.error(400, 'Invalid body')
            data = json.loads(self.rfile.read(size))
        except (ValueError, UnicodeDecodeError):
            return self.error(400, 'Invalid body')
        if not isinstance(data, dict):
            return self.error(400, 'Invalid body')
        class_id, seats = data.get('class_id'), data.get('seats')
        if type(class_id) is not int:
            return self.error(400, 'Invalid class_id')
        item = next((c for c in CLASSES if c['id'] == class_id), None)
        if item is None:
            return self.error(404, 'Class not found')
        if type(seats) is not int or not 1 <= seats <= 4:
            return self.error(400, 'Seats must be an integer from 1 to 4')
        name, email = data.get('name'), data.get('email')
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 60:
            return self.error(400, 'Invalid name')
        if not isinstance(email, str) or not valid_email(email.strip()):
            return self.error(400, 'Invalid email')
        name, email = name.strip(), email.strip().lower()
        with closing(sqlite3.connect(DB, timeout=10)) as db:
            with db:
                db.execute('BEGIN IMMEDIATE')
                used = db.execute('SELECT COALESCE(SUM(seats),0) FROM bookings WHERE class_id=?', (class_id,)).fetchone()[0]
                if used + seats > item['capacity']:
                    return self.error(409, 'Not enough seats')
                total = seats * item['price']
                cursor = db.execute('INSERT INTO bookings(class_id,name,email,seats,total) VALUES(?,?,?,?,?)',
                                    (class_id, name, email, seats, total))
                booking = dict(id=cursor.lastrowid, class_id=class_id, name=name, email=email, seats=seats, total=total)
        self.send(201, booking)


def main():
    global DB
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--data', type=Path, required=True)
    args = parser.parse_args()
    args.data.mkdir(parents=True, exist_ok=True)
    DB = args.data / 'gym.sqlite3'
    with closing(sqlite3.connect(DB)) as db:
        db.execute('CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, seats INTEGER NOT NULL, total INTEGER NOT NULL)')
        db.commit()
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
