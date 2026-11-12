---
version: alpha
name: Fernleaf
description: Calm botanical tea-shop warmth with good stationery.
colors:
  primary: "#2F5D50"
  secondary: "#8FA998"
  tertiary: "#C2603F"
  tertiary-strong: "#A9502F"
  neutral: "#F6F1E7"
  on-surface: "#1F2421"
typography:
  h1:
    fontFamily: Fraunces
    fontSize: 2.5rem
    fontWeight: 600
    lineHeight: 1.2
  h2:
    fontFamily: Fraunces
    fontSize: 1.75rem
    fontWeight: 600
    lineHeight: 1.25
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: 6px
spacing:
  xs: 8px
  sm: 16px
  md: 24px
  lg: 32px
components:
  button-primary:
    backgroundColor: "{colors.tertiary-strong}"
    textColor: "#FFFFFF"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: 12px
  button-primary-hover:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
  card:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.sm}"
    padding: 24px
  link:
    textColor: "{colors.tertiary-strong}"
---

## Overview

Fernleaf is calm, botanical and a little old-fashioned: a tea shop with good stationery. Pages feel like warm paper with ink, not like an app.

## Colors

- **Primary (#2F5D50):** main green for headings and the logo.
- **Secondary (#8FA998):** sage for 1px borders and quiet dividers.
- **Tertiary (#C2603F):** brand terracotta for small accents and illustrations.
- **Tertiary strong (#A9502F):** a darker terracotta for buttons and links. White on #C2603F is only 4.17:1, below WCAG AA (4.5:1); #A9502F reaches 5.42:1 and still reads as terracotta.
- **Neutral (#F6F1E7):** warm paper background.
- **On surface (#1F2421):** body text (14:1 on the paper background).

## Typography

Fraunces at weight 600 for headings, Inter at 16px with 1.6 line height for body text.

## Layout

Everything sits on an 8px grid; the spacing tokens are multiples of 8.

## Elevation & Depth

No drop shadows. Separate surfaces with a 1px sage border ({colors.secondary}) instead.

## Shapes

Buttons and cards use 6px corners. Never pill shapes.

## Components

`button-primary` is the only high-emphasis action on a page: terracotta with white text, turning main green on hover (`button-primary-hover`). Cards are paper-coloured with a sage border.

## Do's and Don'ts

- Do use the strong terracotta for anything interactive.
- Don't put the green and the terracotta next to each other in large blocks.
- Don't add shadows, gradients or pill-shaped buttons.
