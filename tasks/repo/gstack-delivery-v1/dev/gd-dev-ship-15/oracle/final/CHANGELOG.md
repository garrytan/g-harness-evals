# Changelog

## Unreleased

- Added: A bbcode table format for pasting tables into forums. (feature/ebd0af)

## 0.10.0

- Changed: The html format escapes cell text through a private helper, so htmlescape is no longer a module attribute. (feature/5d02c1)
- Changed: Multiline cells are folded into rows in every format except the ones listed in single_line_formats, so github, the outline formats and dokuwiki now fold them. (feature/c41f90)
- Added: A dokuwiki table format. (feature/a83e7b)

## 0.9.0

- Changed: Maintenance release.
