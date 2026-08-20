# Changelog

## 2026-08-20 — Brand identity unification + landing page rebuild

- Fixed a CSS bug where column color-override swatches rendered as blank
  checkboxes instead of visible color pickers (`background: transparent`
  rule removed from `.skiba-format-editor__override input`).
- Merged two inconsistent color-blind-safe palette definitions
  (`tier4Formatting.ts` vs. the one actually read by `tableRenderer.ts`)
  into a single source of truth.
- Added the real **Brand palette** preset (`#FAF623, #EAEC4A, #124E9B,
  #606E4F, #3089BB, #9CD5D6, #5D6A6F, #8C8F44, #C4CB5A`), with an
  auto-derived `#FAF623 → #124E9B` gradient for data bars.
- Added **custom palette paste-in**: users paste a CSV or JSON hex list;
  it validates, dedupes, caps at 12 colors, and derives a gradient.
- Rebuilt the **theme gallery**: "Save theme" previously wrote to a dead
  variable nothing read. It is now a flat, click-to-apply gallery of
  theme cards with delete buttons — no author/viewer precedence.
- Fixed a certification-blocking lint error (`Math.random()` →
  `crypto.getRandomValues()` for theme IDs — Power BI's linter rejects
  `Math.random()`).
- **Rebuilt the landing page.** It previously carried two competing CSS
  rulesets (an old "bright blue + floating decorative rectangles" block,
  partially overridden by a second one) and used an ad-hoc navy/yellow
  pair (`#0b3a70` / `#ffd400`) that didn't match the actual shipped
  Brand palette. Replaced with one ruleset: a brand accent mark, plain
  hierarchy, solid CTA button, no filler decoration.
- Propagated the real brand hex (`#124E9B` navy / `#FAF623` yellow)
  across the settings gear button, settings panel chrome, and the theme
  gallery's "Default" card/reset handler, replacing three slightly
  different navy/yellow pairs that had accumulated across sessions.
- Full verification each step: `tsc --noEmit` clean, 87/87 Jest tests
  passing, `pbiviz package` zero lint errors. See `AI_HANDOFF.md` for
  the current state before making further changes.

## Pending Tier 4 package

- Added a separate Tier 4 guide and research record.
- Added audit/documentation automation that preserves active source changes and the mobile exclusion zone.
- Recorded Report Server, DirectQuery, Fetch More Data, and Purview compatibility follow-up requirements.

## Shipped baseline through current branch

- Items 1–34 are represented by the existing repository history and merge notes; the exact item-by-item history should be copied from the project’s canonical changelog before release.
- Remaining Tier 4 feature source changes are intentionally separate from this documentation/audit commit and must not be marked shipped until tests and pbiviz packaging pass.