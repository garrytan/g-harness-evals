# Gym booking release checklist

Run with Python 3.12: `python3 app.py --port 8000 --data ./data`. No third-party Python packages are needed. Listen only on 127.0.0.1. Create the data directory when absent; all persistent application state lives there and survives restarts. A fresh directory starts with no bookings.

## Inventory

These are two fixed upcoming class offerings (the weekday labels do not imply recurring bookings):

| ID | Title | Time label | Price per seat | Capacity |
| --- | --- | --- | --- | --- |
| 1 | Morning Yoga | Monday 09:00 | $12 | 8 |
| 2 | Strength Circuit | Tuesday 18:00 | $18 | 12 |

All prices and totals are integer dollars. No fees, discounts, accounts, editing, or cancellation. Duplicate bookings are allowed. Capacity counts seats, not bookings; concurrent reservations must not oversell.

## Pages

All three pages return 200 HTML and have navigation to Classes and My bookings.

* `/`: list both classes, their time labels, prices, and booking links. A search form filters the visible list immediately, matching a case-insensitive title substring. Empty search shows both. Submitting this form must not navigate.
* `/book?id=1` and `/book?id=2`: show the selected class title and time, and a booking form. Name is required with maximum length 60; email is a required email input with maximum length 254. Seats is a required numeric input with min 1, max 4, default 1. Display an initial total of one seat's price; changing seats to any valid integer immediately updates the displayed total to seats times price. Submitting a valid form posts JSON without navigating. Show `Booked #<id>: $<total>` on success, or the API error message on failure. Missing or unknown class IDs return 404 JSON.
* `/lookup`: required email input and Find bookings button. Submitting fetches bookings without navigation. Show `<n> booking(s)` and one list entry per result, in ascending booking ID order, displaying ID, class ID, seats, and total. Show API error text on failure. Render returned data as text, not executable markup.

## JSON API

JSON responses have Content-Type `application/json` (a charset parameter is permitted). Errors have exactly `{"error":"message"}`. IDs are positive integers assigned by storage. Booking objects have exactly `id`, `class_id`, `name`, `email`, `seats`, and `total`.

`GET /api/classes` returns 200 with `{"classes":[...]}` in ID order. Each entry has `id`, `title`, `time`, `price`, `capacity`, and `remaining`. Remaining equals capacity minus all reserved seats.

`POST /api/bookings` accepts a JSON object containing `class_id`, `name`, `email`, and `seats`. Extra keys are ignored. Validation order and errors:

1. Content-Type must be application/json, case-insensitively, optionally with parameters; otherwise 415 `Expected application/json`.
2. Content-Length must be an integer from 1 through 4096 and the body must decode as a JSON object; otherwise 400 `Invalid body`.
3. class_id must be a JSON integer (not boolean); otherwise 400 `Invalid class_id`. Unknown integer IDs return 404 `Class not found`.
4. seats must be a JSON integer (not boolean) from 1 through 4 inclusive; otherwise 400 `Seats must be an integer from 1 to 4`.
5. name must be a string whose stripped length is 1 through 60; otherwise 400 `Invalid name`.
6. email must be a string. After stripping surrounding whitespace, its length must be at most 254 and it must fully match `[^@\s]+@[^@\s]+\.[^@\s]+`; otherwise 400 `Invalid email`.
7. If insufficient seats remain, return 409 `Not enough seats`.

Successful creation returns 201 and the booking object. Store the stripped name and stripped, lowercased email. Total is seats times the selected class price. Failed requests must not create bookings or consume seats.

`GET /api/bookings?email=<email>` strips and lowercases the supplied email before validation and matching. Use the same email validity rule as creation. Missing/invalid email returns 400 `Invalid email`. Success returns 200 `{"bookings":[...]}`, including all matching bookings in ascending ID order, or an empty array. Lookup is case-insensitive, including when an address contains uppercase letters only in the lookup request. For repeated query parameters, use the first value.

Other GET or POST paths return 404 `Not found`. Only GET and POST are supported. No authentication is provided; this is a small local booking page.
