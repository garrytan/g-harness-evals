# Changelog

## Unreleased

- Added: SimpleTemplate raw blocks (% raw ... % endraw) write their content without running it. (feature/36ab48)

## 0.15.0

- Fixed: An empty {{ }} expression raises StplSyntaxError instead of IndexError. (feature/c4d917)
- Changed: SimpleTemplate writes each text block with a single _write() call. (feature/91be3a)

## 0.14.0

- Changed: Maintenance release.
