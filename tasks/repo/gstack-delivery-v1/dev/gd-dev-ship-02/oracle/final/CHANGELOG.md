# Changelog

## Unreleased

- Added: html_attrs() renders a dict as HTML attributes, also inside SimpleTemplate templates. (feature/473b30)

## 0.15.0

- Changed: html_escape() takes quote=False to leave quotes alone and converts non-string values with str(), and html_quote() is removed. (feature/5b70e2)
- Added: bottle.__all__ lists the public API, so `from bottle import *` brings in only public names. (feature/c3a18e)

## 0.14.0

- Changed: Maintenance release.
