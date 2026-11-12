# Wiki Schema

## Domain

Home battery storage for a UK house: chemistries, products, tariffs and payback.

## Conventions

- File names: lowercase, hyphens, no spaces (e.g. `lfp-chemistry.md`).
- Every wiki page starts with YAML frontmatter (see below).
- Use `[[wikilinks]]` between pages, at least 2 outbound links per page.
- When updating a page, bump its `updated` date.
- Every new page is added to `index.md` under the right section.
- Every action is appended to `log.md`.
- raw/ is immutable: sources are copied there once with `ingested` and `sha256` frontmatter and never edited.

## Frontmatter

```yaml
---
title: Page Title
created: YYYY-MM-DD
updated: YYYY-MM-DD
type: entity | concept | comparison | query | summary
tags: [from taxonomy below]
sources: [raw/articles/source-name.md]
confidence: high | medium | low
---
```

## Tag Taxonomy

- Hardware: battery, chemistry, product
- Money: tariff, payback, cost
- Meta: comparison, review

Rule: every tag on a page must appear here. Add new tags here first.

## Page Thresholds

- Create a page when an entity or concept appears in 2+ sources or is central to one source.
- Add to an existing page when a source mentions something already covered.
- Split a page over about 200 lines.

## Update Policy

When new information conflicts with a page: check dates, note both positions with sources, and set `contradictions:` in frontmatter.
