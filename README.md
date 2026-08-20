# Data Lake Tables

The fastest, cleanest, most intuitive way to view, slice, and export your Power BI data — without enterprise bloat.

**Author:** Skiba Analytics ([muhumuzabright26@gmail.com](mailto:muhumuzabright26@gmail.com))

## Features

| # | Feature | Status |
|---|---|---|
| 1 | Formula / Calculation Builder | Done |
| 2 | Drag-to-Pivot | Done |
| 3 | Sparklines | Done |
| 4 | Combined / Composite Columns | Done |
| 5 | Full Drill-Down Sub-Grid | Done |
| 6 | Polished PDF Export | Done |
| 7 | Saved Default Views | Done |
| 8 | Admin Access Restrictions | Done |
| 9 | Conditional Link Actions | Done |
| 10 | Allow Interactions | Done |
| 11 | Official Color Theme | Done |
| 12 | Right-Click Context Menu | Done |
| 13 | High-Contrast Mode | Done |
| 14 | Full Keyboard Navigation | Done |
| 15 | Landing Page | Done |
| 16 | Localization | Done |
| 17 | Rendering Status Reporting | Done |
| 18 | Multi-Visual Selection Sync | Done |
| 19 | Native Tooltip Registration | Done |

## Trying it out

1. Import `dist/dataLakeTables_*.pbiviz` into Power BI Desktop via **Visualizations pane → ... → Import a visual from a file**.
2. Drag any table-shaped fields onto it (categories + numeric measures work best).
3. Expand a group and click into a leaf row to try the drill-down sub-grid.

## Building from source

```powershell
npx tsc --noEmit -p .
npx pbiviz package
```

Output lands in `dist/`.

## Data Lake Tables identity standardization

The product-facing name is **Data Lake Tables**. The stable Power BI `name`, `guid`, and `visualClassName` fields remain unchanged deliberately so existing reports and saved visual instances remain compatible. Internal `skiba-*` CSS selectors are also retained because they are implementation selectors and include protected narrow-layout behavior; they are not user-facing branding.

Brand identity is navy `#124E9B` + yellow `#FAF623` (full palette and CSS variables documented in `AI_HANDOFF.md`).

## For AI coding tools

Read **`AI_HANDOFF.md`** and review current source before making changes — several sessions and parallel AI tools have worked on this repo, and colors/palettes have drifted before. It documents the single source of truth for brand identity and the current known state.