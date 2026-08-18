<#
.SYNOPSIS
  Stages the T1 "segment accumulation" deliverables and zips them into one archive.

.WHAT THIS DOES
  1. Creates a staging folder next to this script.
  2. Writes the FULL replacement content for tests/setDataSegments.test.ts
     (safe to overwrite directly -- complete, real content).
  3. Writes two PATCH files (unified-diff style, as plain text with context)
     for src/tableRenderer.ts and src/visual.ts -- these are NOT full files,
     because the full current content of those files was never shown to me.
     Apply each hunk by hand at the location described, or use them as a
     guide with `git apply` if you turn them into real unified diffs against
     your working copy.
  4. Writes a README-T1.md summarizing the two open questions that still need
     your confirmation before this is considered done (group-expand API,
     fetchMoreData mock shape, and the pbiviz apiVersion check).
  5. Zips the staging folder into skiba-tables-T1-segment-accumulation.zip.

.USAGE
  Run this from anywhere (it stages into its own subfolder, doesn't touch
  your repo). Then unzip skiba-tables-T1-segment-accumulation.zip, copy
  setDataSegments.test.ts into your tests/ folder, and apply the two patches
  to src/tableRenderer.ts and src/visual.ts by hand at the marked locations.
#>

$ErrorActionPreference = "Stop"

$stageDir = Join-Path $PSScriptRoot "skiba-tables-T1-staging"
$zipPath  = Join-Path $PSScriptRoot "skiba-tables-T1-segment-accumulation.zip"

if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
New-Item -ItemType Directory -Path $stageDir | Out-Null
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# ---------------------------------------------------------------------------
# 1. FULL replacement content: tests/setDataSegments.test.ts
# ---------------------------------------------------------------------------
$testFilePath = Join-Path $stageDir "setDataSegments.test.ts"
@'
import { TableRenderer } from "../src/tableRenderer";
import {
    makeFakeHost,
    makeFakeSelectionManager,
    makeFakeTooltipService,
    makeFakeLocalizationManager,
    makeFakeColorPalette
} from "./mocks/powerbiMocks";
import { col, row, makeSettings } from "./mocks/fixtures";

function buildRenderer() {
    const container = document.createElement("div");
    const renderer = new TableRenderer(
        container,
        makeFakeHost(),
        makeFakeSelectionManager(),
        makeFakeTooltipService(),
        makeFakeLocalizationManager(),
        makeFakeColorPalette()
    );
    return { renderer, container };
}

const idCol = col("id", { isMeasure: false, isGroupBy: false });

function renderedRowCount(container: HTMLElement): number {
    return container.querySelectorAll('[role="row"]:not(.skiba-table__row--header):not(.skiba-table__row--group)').length;
}

function cellTexts(container: HTMLElement): (string | null)[] {
    return Array.from(container.querySelectorAll(".skiba-table__cell-text")).map((n) => n.textContent);
}

describe("setData() current behavior (real, pre-T1, unchanged by T1)", () => {
    it("an initial call renders exactly the rows passed in", () => {
        const { renderer, container } = buildRenderer();
        renderer.setData([idCol], [], [], [], [row({ id: "A" }), row({ id: "B" }), row({ id: "C" })], makeSettings());
        expect(renderedRowCount(container)).toBe(3);
    });

    it("a second setData() call with isSegmentContinuation left at its default (false) still REPLACES rather than appends " +
        "(only a true segment continuation, exercised below, should append)", () => {
        const { renderer, container } = buildRenderer();
        renderer.setData([idCol], [], [], [], [row({ id: "A" }), row({ id: "B" })], makeSettings());
        expect(renderedRowCount(container)).toBe(2);

        renderer.setData([idCol], [], [], [], [row({ id: "C" }), row({ id: "D" }), row({ id: "E" })], makeSettings());
        expect(renderedRowCount(container)).toBe(3);
        const ids = cellTexts(container);
        expect(ids).not.toContain("A");
        expect(ids).not.toContain("B");
    });

    it("an empty data array with isSegmentContinuation false wipes previously-rendered rows " +
        "(this is the legitimate filter/search-cleared-to-empty case, distinct from a failed segment below)", () => {
        const { renderer, container } = buildRenderer();
        renderer.setData([idCol], [], [], [], [row({ id: "A" }), row({ id: "B" })], makeSettings());
        expect(renderedRowCount(container)).toBe(2);

        renderer.setData([idCol], [], [], [], [], makeSettings());
        expect(renderedRowCount(container)).toBe(0);
    });
});

describe("setData() segment accumulation (T1, real implementation)", () => {
    it("feeding a second segment with isSegmentContinuation=true appends rows rather than replacing, " +
        "and the total row count is the sum of both segments", () => {
        const { renderer, container } = buildRenderer();

        renderer.setData(
            [idCol], [], [], [],
            [row({ id: "A" }), row({ id: "B" })],
            makeSettings({ hasMoreData: true }),
            undefined, undefined,
            false
        );
        expect(renderedRowCount(container)).toBe(2);

        renderer.setData(
            [idCol], [], [], [],
            [row({ id: "C" }), row({ id: "D" }), row({ id: "E" })],
            makeSettings({ hasMoreData: true }),
            undefined, undefined,
            true
        );
        expect(renderedRowCount(container)).toBe(5);
        const ids = cellTexts(container);
        expect(ids).toEqual(expect.arrayContaining(["A", "B", "C", "D", "E"]));
    });

    it.todo(
        "a segment containing rows that belong to an already-expanded group updates that group's " +
            "child rows and subtotal in place, rather than the new rows appearing as ungrouped top-level entries " +
            "-- NEEDS CONFIRMATION: what is the real API/interaction to expand a group before feeding the second " +
            "segment? (e.g. renderer.expandGroup(key), or a DOM click on .skiba-table__row--group). Not guessing at this."
    );

    it("an empty/failed segment update (isSegmentContinuation=true, data=[]) preserves already-rendered rows " +
        "(contrast with the isSegmentContinuation=false empty case above, which legitimately clears to 0)", () => {
        const { renderer, container } = buildRenderer();

        renderer.setData(
            [idCol], [], [], [],
            [row({ id: "A" }), row({ id: "B" })],
            makeSettings({ hasMoreData: true }),
            undefined, undefined,
            false
        );
        expect(renderedRowCount(container)).toBe(2);

        renderer.setData(
            [idCol], [], [], [],
            [],
            makeSettings({ hasMoreData: true }),
            undefined, undefined,
            true
        );
        expect(renderedRowCount(container)).toBe(2);
        const ids = cellTexts(container);
        expect(ids).toEqual(expect.arrayContaining(["A", "B"]));
    });

    it("once hasMoreData is false, getDataRowCount() reflects the final accumulated total and stays stable " +
        "across a further isSegmentContinuation=true call with no new rows " +
        "(end-of-pagination idempotency, observed via renderer state rather than mocking host.fetchMoreData directly " +
        "-- NEEDS CONFIRMATION: is there a more direct way to assert fetchMoreData() wasn't called again, e.g. a " +
        "jest.fn() on makeFakeHost().fetchMoreData? Using getDataRowCount() as a proxy since I don't know that mock's shape.)", () => {
        const { renderer } = buildRenderer();

        renderer.setData(
            [idCol], [], [], [],
            [row({ id: "A" }), row({ id: "B" })],
            makeSettings({ hasMoreData: false }),
            undefined, undefined,
            false
        );
        expect(renderer.getDataRowCount()).toBe(2);

        renderer.setData(
            [idCol], [], [], [],
            [],
            makeSettings({ hasMoreData: false }),
            undefined, undefined,
            true
        );
        expect(renderer.getDataRowCount()).toBe(2);
    });

    it("search operates correctly against the accumulated (multi-segment) dataset without dropping already-loaded rows " +
        "-- NEEDS CONFIRMATION: what is the real search API? (e.g. renderer.setSearchTerm(), a public method, or only " +
        "reachable via a DOM input event). Not guessing at this either.", () => {
        const { renderer, container } = buildRenderer();

        renderer.setData(
            [idCol], [], [], [],
            [row({ id: "Apple" }), row({ id: "Banana" })],
            makeSettings({ hasMoreData: true }),
            undefined, undefined,
            false
        );
        renderer.setData(
            [idCol], [], [], [],
            [row({ id: "Cherry" })],
            makeSettings({ hasMoreData: false }),
            undefined, undefined,
            true
        );
        expect(renderedRowCount(container)).toBe(3);
        // TODO: once the real search entry point is confirmed, assert that
        // searching for e.g. "Cherry" (a row from the *second* segment)
        // still finds it -- this is the actual regression this requirement
        // is guarding against and isn't exercised yet.
    });
});
'@ | Set-Content -Path $testFilePath -Encoding UTF8

# ---------------------------------------------------------------------------
# 2. Patch notes: src/tableRenderer.ts
# ---------------------------------------------------------------------------
$patch1Path = Join-Path $stageDir "PATCH-1-tableRenderer.ts.txt"
@'
FILE: src/tableRenderer.ts
=================================================================

HUNK A -- inside setData(), replace this line:

    this._data = data;

with:

    if (isSegmentContinuation) {
        // Genuine Fetch More Data segment. With fetchMoreData(false) (see
        // HUNK B below), `data` here is just the new incremental chunk, not
        // the cumulative set -- so we append.
        //
        // An empty/failed segment (fetch came back with 0 rows while
        // isSegmentContinuation is still true) must NOT wipe what's already
        // rendered -- only a genuine non-segment update (filter/sort/search,
        // isSegmentContinuation === false) is allowed to legitimately clear
        // to empty, in the branch below.
        if (data.length > 0) {
            this._data = this._data.concat(data);
        }
    } else {
        // Filter change, sort change, search, or the very first load --
        // always a full replace, including a legitimate empty result.
        this._data = data;
    }

-----------------------------------------------------------------

HUNK B -- inside requestMoreData() (the block with the
`if (!this._hasMoreData || this._isFetchingMore || this.isExportRestricted())`
guard), replace this line:

    const accepted = this.host.fetchMoreData();

with:

    // aggregateSegments = false: request the incremental chunk only, so
    // setData() above can append it. Leaving this as the default (true)
    // would make Power BI hand back the full cumulative rows each time,
    // and the append above would double-count everything already shown.
    const accepted = this.host.fetchMoreData(false);

  ** REQUIRES apiVersion >= 3.4 in pbiviz.json (aggregateSegments param) **
  ** Confirm this before merging. **

-----------------------------------------------------------------

HUNK C -- add a new public method, anywhere in the class body near
setData() (used by visual.ts to read the true accumulated row count):

    public getDataRowCount(): number {
        return this._data.length;
    }
'@ | Set-Content -Path $patch1Path -Encoding UTF8

# ---------------------------------------------------------------------------
# 3. Patch notes: src/visual.ts
# ---------------------------------------------------------------------------
$patch2Path = Join-Path $stageDir "PATCH-2-visual.ts.txt"
@'
FILE: src/visual.ts
=================================================================

HUNK A -- REMOVE this block entirely (around line ~180-190, just before the
"if (!table || !table.rows ..." empty-state check):

    if (
        isSegmentContinuation &&
        table &&
        table.rows &&
        table.rows.length < this.lastRenderedRowCount
    ) {
        return;
    }

WHY: this guard compared a single segment's row count against the previously
accumulated total. That comparison only made sense if each update's
table.rows.length was a running cumulative count (the old, default
aggregateSegments=true assumption). Now that requestMoreData() calls
fetchMoreData(false) (see tableRenderer.ts patch, HUNK B), a segment's row
count is just that chunk's size (e.g. 200) and will almost always be less
than the cumulative total already on screen (e.g. 1,000) -- so this guard
would misfire on nearly every legitimate segment and silently drop real
Fetch More Data updates. The "don't regress on a bad update" protection this
existed for is now handled inside TableRenderer.setData() itself (an empty
isSegmentContinuation data array preserves existing rows instead of wiping
them).

-----------------------------------------------------------------

HUNK B -- replace this line (right after the tableRenderer.setData(...) call,
around line ~248):

    this.lastRenderedRowCount = table.rows.length;

with:

    // lastRenderedRowCount now needs to mean "cumulative rows actually held
    // by the renderer," not "rows in this one dataView call" -- read it back
    // from the renderer rather than from the segment size.
    this.lastRenderedRowCount = this.tableRenderer.getDataRowCount();

** Check for any OTHER read sites of this.lastRenderedRowCount in visual.ts
   before assuming this is the only place it needs to change -- I have not
   seen the full file. **
'@ | Set-Content -Path $patch2Path -Encoding UTF8

# ---------------------------------------------------------------------------
# 4. README
# ---------------------------------------------------------------------------
$readmePath = Join-Path $stageDir "README-T1.md"
@'
# T1 -- Segment accumulation package

## Apply in this order
1. Copy `setDataSegments.test.ts` into `tests/` (full replacement, safe).
2. Apply `PATCH-1-tableRenderer.ts.txt` hunks A, B, C to `src/tableRenderer.ts`.
3. Apply `PATCH-2-visual.ts.txt` hunks A, B to `src/visual.ts`.
4. Run the test suite.

## The one finding that matters most
`host.fetchMoreData()` defaults to `aggregateSegments = true`, which means
Power BI hands back the FULL cumulative dataView on every segment call unless
you explicitly pass `false`. The current code calls `fetchMoreData()` with no
argument -- i.e. it's already in aggregated mode today. Switching
TableRenderer to append (Hunk A) WITHOUT also switching the fetch call to
non-aggregated mode (Hunk B) will double/triple/etc. every row. Both hunks
must land together.

**Confirm your `pbiviz.json` apiVersion is >= 3.4** -- the `aggregateSegments`
parameter doesn't exist before that.

## Three things I flagged as unverified, not guessed at
1. **Group-expand API** -- one test is left as `it.todo()` because I don't
   know the real method/interaction for expanding a group in this codebase.
2. **Asserting fetchMoreData() isn't re-called** once pagination ends -- I
   substituted an indirect check (`getDataRowCount()` stays stable) because I
   don't know `makeFakeHost()`'s shape (whether `fetchMoreData` is a
   `jest.fn()` you can assert call-counts on).
3. **`makeSettings()` signature** -- I assumed it accepts a partial-overrides
   object, e.g. `makeSettings({ hasMoreData: true })`. If the real fixture
   takes positional args or doesn't support overrides, the new tests won't
   compile as written.

Fastest way to resolve all three: `Get-Content .\tests\mocks\fixtures.ts` and
`Select-String -Path .\src\tableRenderer.ts -Pattern "expand"` -- send me the
output and I'll finalize the `it.todo()`s.
'@ | Set-Content -Path $readmePath -Encoding UTF8

# ---------------------------------------------------------------------------
# 5. Zip it
# ---------------------------------------------------------------------------
Compress-Archive -Path (Join-Path $stageDir "*") -DestinationPath $zipPath -Force

Write-Host "Done."
Write-Host "Staged files: $stageDir"
Write-Host "Zip:          $zipPath"
