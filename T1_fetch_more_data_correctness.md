# T1 — Skiba Tables: Fetch More Data Correctness + Tier-Gating Decisions

Paste this entire prompt into your coding AI tool as the system/task prompt for this work stream.

---

## Project context (read fully before writing any code)

You are working on **Skiba Tables**, a Power BI custom visual written in TypeScript. The main visual class lives in `src/visual.ts`. The project is built with `npx pbiviz package` and type-checked with `npx tsc --noEmit -p .`. CI runs on GitHub Actions. Development happens on Windows via PowerShell — when patching files, use `Get-Content -Path $path -Raw` and `Set-Content -Path $path -Value $content -NoNewline -Encoding UTF8`, never `[System.IO.File]::ReadAllText()`, because that resolves relative to the process working directory, not PowerShell's current location, and silently fails to find the file.

**Already shipped (19 numbered items — do not re-implement, only extend):**
- Item 6: Export to PDF/CSV/Excel
- Item 8: A "no-export" permission flag that can restrict export
- Item 9: Conditional formatting — a min/max color-scale applied to cell values, computed from currently loaded data
- Item 14: Keyboard navigation (tabIndex, role="button", keydown handlers — see the existing drag-pivot chip control for the reference pattern)
- Item 16: Localization — every user-facing string goes through `this.loc()` backed by `stringResources`
- Item 17: `renderingFailed` — an existing diagnostic surface for full render failures

**Recently fixed:** a landing-page-flicker bug, solved by adding a `hasRenderedRealData` boolean flag to the visual class. Once real table data has rendered once, a later empty/transient `update()` call (e.g. from segment reconciliation) no longer wipes the table back to the landing page. This flag and its guard logic already exist in `visual.ts` — build your new logic to respect and interact correctly with it, don't remove or bypass it.

**In progress / assumed to exist by the time you run this:** "Fetch More Data" — a paginated data-loading mechanism (Power BI's `fetchMoreData` API) that lets the visual request additional row segments beyond the initial ~30,000-row platform load ceiling. This is the paid-tier differentiator versus the competing visual "SuperTables" (which caps its free tier at 100 rows with upsell nags — Skiba Tables' base tier already renders the full ~30K window with no cap, so Fetch More Data is positioned as pushing *past* that ceiling, not gating what's already free). Segments arrive with a `.more` flag indicating whether further data is available; row-merging/accumulation happens inside `setData()`.

Your job is to make that pagination mechanism **correct** under real usage, not just functional in the happy path.

---

## Task list — implement all of these, in this order

### D1 — Decision (do this FIRST, before touching code)
Decide and document, in a code comment at the top of the fetch-more-data logic and in a short paragraph in your final summary: **does the existing "no-export" permission (item 8) also block Fetch More Data?** Reasoning to weigh: an unlimited-scroll capability is functionally export-adjacent for a read-only viewer who could scroll-and-copy unlimited rows client-side even without formal export. Recommended default if no stronger signal exists in the codebase: **yes, gate it under the same permission**, but implement whichever is more consistent with how item 8 is already wired into the codebase — inspect how the no-export flag is currently checked (likely gating the export button/menu items 6) and reuse that exact check point for Fetch More Data's trigger (scroll-triggered fetch, "Load more" button, or both).

### D2 — Internal note (documentation only, no code logic needed)
Add a code comment near the license/tier-checking logic stating plainly: license gating here is **client-trust, not real DRM** — a bound DAX measure used for tier detection can be edited by anyone with model-editing access in Power BI Desktop. This is acceptable for this product category but must never be described to a client as tamper-proof. Put this same note in your final summary so it's on record outside the code too.

### A1 — Conditional-formatting rescale across segments (~1 day)
The item-9 color scale's min/max bounds are currently computed once from the loaded dataset. When a new Fetch More Data segment arrives:
1. Recompute the min/max bounds across the **full accumulated dataset** (all segments loaded so far), not just the newest segment.
2. Re-apply color formatting to **already-rendered rows**, not only the newly added ones — if the new segment introduces a more extreme value, every row's color must be re-evaluated against the new bounds, since an old row's relative position in the scale may have shifted.
3. Do this without a full re-render/flicker of the table — update styles/classes on existing DOM rows in place where possible.
4. Test case to satisfy: load initial segment, note the color of the current max-value row, trigger a fetch that brings in a higher value, confirm the *old* max-value row's color changes to reflect it's no longer the extreme.

### A2 — Grouping state integrity across segments (~1 day)
New rows arriving mid-scroll may belong to groups the user has already expanded (via the existing drag-pivot grouping feature).
1. When a new segment arrives, check each new row against the current grouping state (however group membership/expansion is tracked in the codebase — likely something like `_dragGroupColumn` / `_groupExpansion`).
2. If a new row belongs to an already-expanded group, it must be inserted into that group's child rows, and the group's row count and subtotal must recompute — not just append as an ungrouped/new top-level row.
3. If a new row belongs to a *collapsed* group, the group's count/subtotal still updates but child rows stay hidden until expanded.
4. Test case to satisfy: expand a group, trigger a fetch, confirm the group's displayed row count, actual child row list, and subtotal all update correctly — write this as a description of manual test steps since you may not have live Power BI to run it against.

### A3 — Search/filter against partial data (~0.5 day)
Implement this decision: **search/filter matches loaded rows only by default** (fast, but a "no results" message could be misleading if unloaded rows would have matched). Add an explicit affordance — e.g. a small "Search full dataset" link/button that appears when a search returns results while `segment.more` is still true — that, when clicked, force-fetches all remaining segments and then re-runs the search. Make sure this affordance is localized (`this.loc()`) and keyboard-reachable (same pattern as item 14).

### A4 — Export while partially loaded (~1 day)
Decide and implement: the export action (item 6, PDF/CSV/Excel) must **never silently truncate data**. Before generating the export file, if `segment.more` is true, force-fetch all remaining segments first. If this could take more than ~1-2 seconds, show a progress indicator (spinner + row-count-loading text, localized) so the user understands why export is delayed rather than assuming it's frozen. Respect the D1 decision — if Fetch More Data is gated by the no-export permission, a no-export user's export button should already be disabled/hidden and this code path won't be reached for them.

---

## Output format
For each numbered task (D1, D2, A1–A4), provide:
1. The exact code change as a diff or a clearly marked before/after snippet against `src/visual.ts` (and any other file you determine needs changes — state which file).
2. A one-paragraph explanation of the approach.
3. Manual test steps a human can follow in Power BI Desktop to verify it (since this can't run live in your environment).

Do not modify or remove the `hasRenderedRealData` flag's existing guard logic. Do not touch items 1-19 except where a task above explicitly says to extend one of them. Run `npx tsc --noEmit -p .` mentally against your changes — flag any type-safety concerns you can't verify without a live compiler.
