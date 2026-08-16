# Skiba Tables

A Power BI custom visual — an Excel-like, interactive data grid built to be a
better version of [SuperTables](https://appsforpowerbi.infotopics.com/supertables/)
(Infotopics), without the enterprise licensing bloat.

Built with `pbiviz` (powerbi-visuals-tools), TypeScript, D3, and the Power BI
formatting-model API. No external UI framework — the renderer is vanilla
DOM manipulation for minimal bundle size and full control over virtualization.

---

## Status: ~56% toward full feature parity with the target spec

See [Feature status](#feature-status) below for the detailed breakdown.

---

## Features

### Done
- Table render, column resize, drag-to-reorder columns, hide/show columns
- Virtual scrolling (smooth on large datasets, on by default)
- Click-to-sort (asc → desc → none, with visible arrows)
- Global quick-search across all columns
- Per-column filters (text/number/date, type-inferred) with a removable
  filter-chip strip
- Multi-level grouping via the "Group by" data role — expand/collapse,
  per-group aggregate rollups, expand-all/collapse-all
- Cross-filter selection (click a row to filter other visuals on the page;
  click empty space to clear)
- Data bars (in-cell bar chart backgrounds) for measure columns
- Value-based conditional formatting (two-color scale, configurable)
- Smart tooltips showing mean / % variance / standard deviation on hover
- Totals row (per-column sums)
- Branded empty state
- Export to CSV
- Export to real .xlsx (via SheetJS)
- Export to PDF (via browser print — functional but not a dedicated
  multi-page PDF renderer)

### Not yet built
- **Calculations** — no formula/aggregate editor, no IF/ELSE conditional
  logic, no date-math helpers. This is the single largest gap and
  SuperTables' signature differentiator.
- **Drag-to-pivot** — grouping exists, but there's no UI to turn a column's
  values into new columns on the fly.
- **Sparklines** — no per-group trend visualization in cells.
- **Combined/composite columns** — no way to merge and style multiple
  fields into one display cell.
- **True nested drill-down sub-grid** — grouping partially covers this, but
  there's no dedicated drill-through into a separate detail grid.
- **Saved personal views** — deferred pending a design decision. Power BI
  custom visuals have no native per-viewer storage API; this would need
  either report-level persistence via `host.persistProperties` (shared
  across everyone editing the report, not private per-viewer) or an
  external backend.
- **Admin-configurable user restrictions** — e.g. disabling export or sort
  for certain users. Same storage-design blocker as saved views.
- **URL actions** — click-to-launch links from cells based on column/value.

---

## Feature status

| Category | Status | Notes |
|---|---|---|
| Core Grid / Table Structure | ~95% | render, resize, reorder, hide/show, virtual scroll all done |
| Sorting & Filtering | ~85% | sort, per-column filters, global search done; no dedicated filter sidebar |
| Grouping & Pivoting | ~75% | grouping/expand-collapse/rollups done; no drag-to-pivot |
| Calculations | 0% | nothing built |
| Formatting & Styling | ~40% | data bars + conditional color scale done; no sparklines/combined columns |
| Interaction & Drill | ~65% | cross-filter selection solid; no true nested drill sub-grid |
| Personalization & Governance | ~25% | empty state + basic keyboard only; no saved views or admin restrictions |
| Export & Sharing | ~65% | CSV + Excel done; PDF is browser-print; no URL actions |

---

## Project structure

```
skiba-tables/
├── src/
│   ├── visual.ts           # IVisual entry point — parses the Power BI DataView,
│   │                        # splits fields into rows/groupBy/values, wires settings
│   ├── tableRenderer.ts    # All rendering logic: virtualization, grouping,
│   │                        # filtering, sorting, export, tooltips, conditional formatting
│   └── visualSettings.ts   # Format-pane cards (General, Header, Cells, Data bars,
│                             Totals, Virtual scrolling, Toolbar, Search, Grouping,
│                             Column filters, Conditional formatting)
├── style/
│   └── visual.less          # All CSS, using --skiba-* custom properties for theming
├── capabilities.json        # Data roles (Rows, Values, Group by, Tooltips) and
│                             # format-pane object schema
├── pbiviz.json               # Visual metadata (name, GUID, version, author)
└── tsconfig.json
```

---

## Development setup

```cmd
npm install
npm start
```

This starts the `pbiviz` dev server at `https://localhost:8080`. Add the
**Developer Visual** to a Power BI Desktop or Power BI Service report to see
live changes (requires enabling developer mode — see
[Microsoft's docs](https://learn.microsoft.com/en-us/power-bi/developer/visuals/frame-control-add-custom-visual)).

### Known local dev gotchas
- `powerbi-visuals-tools` must be at least v6.2+ — earlier versions have a
  webpack source-map bug that throws `Multiple assets emit different
  content to the same filename`.
- The visual's GUID (in `pbiviz.json`) must not contain hyphens — pbiviz's
  code generator inserts it unquoted into generated TypeScript, and hyphens
  get parsed as subtraction operators, corrupting the build.
- Power BI Desktop's Developer Visual icon can be unreliable to surface even
  with developer mode on. If it doesn't show up, package and import instead
  (see below) — much less friction.

### Packaged workflow (no dev server, no cert warnings)

```cmd
npx pbiviz package
```

Produces a `.pbiviz` file in `dist\`. Import it directly in Power BI Desktop:
Visualizations pane → **"..."** → **"Import a visual from a file"**. Slower
to iterate (no hot reload — repackage and reimport per change) but far more
reliable than the live dev server for just checking that something works.

---

## Data roles

| Role | Purpose |
|---|---|
| **Rows** | Plain dimension columns, displayed as normal table columns |
| **Group by** | Dimension columns used to build nested, collapsible groups instead of flat columns. Multiple fields create multi-level nesting. |
| **Values** | Numeric measures |
| **Tooltips** | Fields shown only on row hover, excluded from the visible grid |

---

## License / Author

Skiba Analytics — internal project, not yet published to AppSource.
