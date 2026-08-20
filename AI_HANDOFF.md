# AI Handoff Notes — Data Lake Tables (Skiba Tables)

**Read this file, and review the current source, before changing anything
in this repo.** Several sessions (including separate AI coding tools
working on parallel streams — see `T1_fetch_more_data_correctness.md` and
`MERGE_NOTES.md`) have touched this codebase, and colors, palettes, and
UI copy have drifted before. Assume nothing about current state from an
older summary — `git log --oneline -10` and read the actual files below
first.

## Do this before making any change

1. `git status` and `git log --oneline -10` — confirm you're working from
   the real current `main`, not a stale local branch.
2. `npx tsc --noEmit -p .` and `npx jest` — confirm the baseline is green
   before you touch anything, so you know any new failure is yours.
3. Read `src/tier4Formatting.ts` (palette definitions) and the "Brand
   identity" section below before touching any color, theme, or palette
   code — there is exactly one correct brand palette, defined once, and
   past sessions have accidentally invented second/third versions of it.
4. After any change: `npx tsc --noEmit -p .` → `npx jest` → `npx pbiviz
   package`, all clean, before considering the change done.

## Brand identity — the single source of truth

The real brand palette (defined in `src/tier4Formatting.ts`, the
`brand` entry in `DLT_PALETTE_PRESETS`):

```
#FAF623  (primary yellow)
#EAEC4A
#124E9B  (primary navy)
#606E4F
#3089BB
#9CD5D6
#5D6A6F
#8C8F44
#C4CB5A
```

Primary identity = **navy `#124E9B`** + **yellow `#FAF623`**, defined once
as CSS custom properties in `style/visual.less`:

```less
:root { --dlt-navy: #124e9b; --dlt-blue: #3089bb; --dlt-sky: #9cd5d6; --dlt-yellow: #faf623; --dlt-ink: #102a43; --dlt-surface: #f5f9fc; }
```

As of 2026-08-20 this is used consistently for: the landing page, the
settings gear button, the settings panel chrome, and the theme gallery's
"Default" card. **Before this date it was not** — three different
navy/yellow-ish pairs had accumulated (`#0b3a70`/`#ffd400` in one place,
lime-green `#344700`/`#DFFF91` in another, the real brand hex only inside
the palette picker itself). If you're about to add a new color anywhere
in the UI chrome, use the `--dlt-*` variables — don't invent a new hex
literal, even one that "looks close."

The "URA navy and yellow" preset (`#FFF4A3` / `#0B3A70` in
`DLT_PALETTE_PRESETS`) is a **deliberately separate, alternate** data
palette option — not the brand identity. Don't merge it with the above.

## What changed in the two most recent commits

`28a5335` — Rewire in-visual formatting:
- Fixed column color-override swatches rendering as blank checkboxes
  (dead `background: transparent` rule).
- Merged two inconsistent color-blind-safe palette definitions into one.
- Added the real Brand palette preset + derived data-bar gradient.
- Added custom palette paste-in (CSV/JSON hex list, validated, capped at 12).
- Rebuilt the theme gallery ("Save theme" previously wrote to a dead
  variable; now a real flat gallery with delete).
- Fixed a certification-blocking lint error (`Math.random()` →
  `crypto.getRandomValues()`).

`7070e79` — Unify brand identity + rebuild landing page:
- Landing page (`TableRenderer.renderLandingPage` in
  `src/tableRenderer.ts`, styles under `.skiba-landing-page` in
  `style/visual.less`) had two competing CSS rulesets stacked on top of
  each other, plus decorative floating rectangles that added nothing.
  Replaced with one ruleset, no filler decoration.
- Propagated real brand hex to the settings button, settings panel, and
  theme gallery default (previously off-brand).

Both verified: `tsc --noEmit` clean, 87/87 Jest tests, `pbiviz package`
zero lint errors, before being committed.

## Known trade-offs / things intentionally left alone

- `visualSettings.ts` default `barColor`/`headerBg` (`#0078D4`, Power BI's
  own default blue) is the **true out-of-box default** before a user
  picks a theme — this is a deliberate Power BI convention, not a
  brand-identity gap. Don't "fix" it to brand navy.
- The lime-green (`#344700`/`#efffc9`/`#dfff91`) declarations still
  present in `style/visual.less` for `.skiba-toolbar__menu` /
  `.skiba-tier4-section` are currently **overridden** at runtime by the
  more specific `.datalake-tables-settings-menu` descendant selectors
  (confirmed via computed cascade, not just by eye) — they're dead in
  practice but not deleted. Safe to clean up in a future pass; not worth
  the risk of doing it blind.
