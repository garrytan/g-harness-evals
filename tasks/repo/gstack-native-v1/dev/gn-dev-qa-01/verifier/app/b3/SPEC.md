# Volunteer shifts

Run with Python 3.12: `python3 app.py --port 8080 --data ./data`. No third-party packages are required. The server binds to 127.0.0.1. It creates the data directory and stores all persistent application state there. Restarting with that directory preserves shifts and signups. A new directory starts empty. JavaScript must be enabled for form submission.

## Pages

- `GET /` returns HTTP 200 HTML, including when empty. It lists shifts in ascending ID order with escaped titles, hours, available places, capacity, and a sign-up link. Navigation links lead to `/` and `/new`.
- `GET /new` returns HTTP 200 HTML with a create form: title, places (`capacity`), and hours. Defaults are 2 places and 3 hours. Numeric fields use integer steps and the API limits below. The displayed total person-hours equals places multiplied by hours, both initially and immediately after either input changes. The form submits JSON to the create API and navigates to `/` on success.
- `GET /signup?id=<shift ID>` returns HTTP 200 HTML showing that shift's escaped title, hours, available places, and a form for name and email. Unknown or missing/noninteger IDs return 404. The form submits JSON to the signup API and navigates to `/` on success. A full shift can still be viewed, but cannot accept a signup.
- Both forms use required inputs, the stated maximum text lengths, and an email-type input where appropriate. API failures are displayed as text in the form's alert region without navigation; submission is re-enabled. Successful submissions become visible on the home page.

## JSON API

Responses use `application/json` with UTF-8. Error responses have exactly one property, `error`, containing a human-readable string. Unknown paths return 404. Query parameters do not change API operations. POST bodies must be JSON objects, encoded as UTF-8, with a Content-Length from 1 through 16384 bytes; invalid bodies return 400. Clients should send Content-Type application/json. Extra object properties are ignored.

`GET /api/shifts` returns 200 with `{"shifts": [...]}`. Each entry has exactly `id`, `title`, `capacity`, `hours`, `booked`, and `slots`. IDs and counts are integers. Entries are ordered by ascending ID; `booked` is the number of successful signups and `slots = capacity - booked`. An empty database returns an empty array.

`POST /api/shifts` accepts:
- `title`: string, trimmed before validation and storage; trimmed length 1–80 inclusive.
- `capacity`: JSON integer from 1–12 inclusive.
- `hours`: JSON integer from 1–8 inclusive.

Booleans, strings, and floating-point JSON numbers are not accepted as integer fields. Missing or invalid fields return 422, with no shift created. Success returns 201 with exactly `{"id": <new positive integer>}`. Titles need not be unique.

`POST /api/shifts/<ID>/signups` accepts a positive integer ID in the path and:
- `name`: string, trimmed before validation and storage; trimmed length 1–60 inclusive.
- `email`: string, trimmed before validation and storage; maximum trimmed length 120. It must match `[^\s@]+@[^\s@]+\.[^\s@]+` over the entire value.

Missing or invalid fields return 422. For valid fields, an unknown shift returns 404. Each email may sign up only once per shift, comparing trimmed emails case-insensitively for ASCII letters. A duplicate returns 409 even if the shift is full. Otherwise a full shift returns 409. A rejected signup changes no state. Success returns 201 with exactly `{"id": <new positive integer>, "shift_id": <shift ID>}`. Duplicate names are allowed; an email may sign up for multiple different shifts. Capacity cannot be exceeded, including concurrent requests. No editing or deletion is provided.
