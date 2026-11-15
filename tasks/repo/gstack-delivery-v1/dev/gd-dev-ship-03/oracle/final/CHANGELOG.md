# Changelog

## Unreleased

- Added: best_match() and request.best_match() pick the media type an Accept header prefers. (feature/1d9333)

## 0.15.0

- Added: parse_link_header() parses HTTP Link headers. (feature/7a41c9)
- Changed: _parse_http_header() returns header parameters as (name, value) pairs in order, so repeated parameters are kept. (feature/2e8d05)
- Added: __all__ lists the public API, so `from bottle import *` imports only public names. (feature/c3f19a)

## 0.14.0

- Changed: Maintenance release.
