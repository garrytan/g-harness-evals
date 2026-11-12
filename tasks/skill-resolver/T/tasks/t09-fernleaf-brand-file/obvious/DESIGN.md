# Fernleaf design system

The single source of truth for colours, type and components on the Fernleaf site. Use these values exactly; do not invent new colours.

**Feel:** calm, botanical, a bit old-fashioned, like a tea shop with good stationery.

## Colour palette

| Name | Hex | Use |
|---|---|---|
| `--color-green` | #2F5D50 | Headings, logo, button hover |
| `--color-sage` | #8FA998 | 1px borders, dividers |
| `--color-terracotta` | #C2603F | Buttons, links |
| `--color-paper` | #F6F1E7 | Page background |
| `--color-ink` | #1F2421 | Body text |

Note: white text on terracotta is 4.17:1, slightly under WCAG AA for normal text. Use 16px semibold or larger on buttons, or darken the terracotta if accessibility review asks.

## Typography

- Headings: Fraunces, weight 600.
- Body: Inter, 16px, line height 1.6.

## Spacing and shape

- 8px grid: use 8, 16, 24, 32px.
- 6px corner radius on buttons and cards. Never pill shapes.
- No drop shadows; use a 1px sage border instead.

## Components

- **Primary button:** terracotta background, white text, 6px radius, 12px padding. Hover: main green background.
- **Card:** paper background, 1px sage border, 6px radius, 24px padding.
- **Link:** terracotta text.

## Rules

- Never put the green and the terracotta next to each other in large blocks.
- Don't add colours that are not in the palette above.
