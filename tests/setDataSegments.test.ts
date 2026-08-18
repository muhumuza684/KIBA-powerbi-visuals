/**
 * E2 target #2 from T3: "segment accumulation in setData()".
 *
 * *** FLAG *** As of this commit, `setData()` has no concept of segments,
 * pagination, or "Fetch More Data" at all -- see tableRenderer.ts:371-419.
 * Every call does `this._data = data;` (a full replace), then reruns the
 * pipeline and a full render. There is no `fetchMoreData`, no `.more` flag,
 * no `hasRenderedRealData` guard anywhere in src/. This confirms the T3
 * prompt's own caveat ("If T1/T2 haven't landed yet ... write your test
 * scaffolding against the described interfaces/behavior above and flag
 * clearly which assertions are provisional") applies to the whole of this
 * file's second describe block.
 *
 * The tests in the first block below are real and pass against the current
 * code -- they pin down exactly the "replace, not append" behavior that T1's
 * accumulation change needs to replace, so they double as a trip-wire: if
 * this block's "second setData() call replaces the first segment's rows"
 * test starts FAILING (i.e. starts accumulating) without T1 having
 * consciously changed that code path, that's a sign of an accidental
 * behavior change, not a landed feature -- check for the real T1 PR before
 * assuming this test just needs deleting.
 *
 * The second block is explicitly `describe.skip`ped scaffolding for the
 * behavior T1 is expected to add. It documents the real interfaces named in
 * the T3 prompt (fetchMoreData / segment.more / hasRenderedRealData) but
 * every assertion inside is a placeholder pending the actual T1 code -- do
 * not un-skip it without first inspecting T1's real implementation and
 * function names, per the same instruction above.
 */
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
    // Leaf data rows only -- excludes the header row (also role="row"), any group-header
    // rows, and the top/bottom virtual-scroll spacer divs (which aren't role="row" at all).
    return container.querySelectorAll('[role="row"]:not(.skiba-table__row--header):not(.skiba-table__row--group)').length;
}

describe("setData() current behavior (real, pre-T1)", () => {
    it("an initial call renders exactly the rows passed in", () => {
        const { renderer, container } = buildRenderer();
        renderer.setData([idCol], [], [], [], [row({ id: "A" }), row({ id: "B" }), row({ id: "C" })], makeSettings());
        expect(renderedRowCount(container)).toBe(3);
    });

    it("a second setData() call REPLACES the first call's rows rather than appending them " +
        "(this is the exact behavior T1's Fetch More Data accumulation must change)", () => {
        const { renderer, container } = buildRenderer();
        renderer.setData([idCol], [], [], [], [row({ id: "A" }), row({ id: "B" })], makeSettings());
        expect(renderedRowCount(container)).toBe(2);

        renderer.setData([idCol], [], [], [], [row({ id: "C" }), row({ id: "D" }), row({ id: "E" })], makeSettings());
        // Today: 3, not 5 -- proves replacement. Once T1 lands real accumulation inside
        // setData() (appending new-segment rows to the existing in-memory row list rather
        // than the caller passing the caller's own already-concatenated array), this
        // specific assertion is expected to need updating to reflect the new call contract
        // -- check how T1's setData() signature/caller distinguishes "replace" (e.g. filter
        // change, sort) from "append" (a fetchMoreData segment) before changing this test.
        expect(renderedRowCount(container)).toBe(3);
        const ids = Array.from(container.querySelectorAll(".skiba-table__cell-text")).map((n) => n.textContent);
        expect(ids).not.toContain("A");
        expect(ids).not.toContain("B");
    });

    it("an empty data array wipes previously-rendered rows (there is no hasRenderedRealData guard yet)", () => {
        const { renderer, container } = buildRenderer();
        renderer.setData([idCol], [], [], [], [row({ id: "A" }), row({ id: "B" })], makeSettings());
        expect(renderedRowCount(container)).toBe(2);

        renderer.setData([idCol], [], [], [], [], makeSettings());
        // This is the landing-page-flicker failure mode from the T3 prompt's own history,
        // reproduced deliberately: today, a failed/empty update DOES wipe already-rendered
        // rows, because nothing in setData() special-cases an empty segment. T1's
        // `hasRenderedRealData` guard is specifically meant to prevent this. Once that guard
        // exists, this test's expectation should flip to `toBe(2)` (rows preserved) for the
        // "empty segment update" case -- but only for that case; a genuine user-driven
        // "no rows match" (search/filter) result should still legitimately clear to 0, so
        // don't blanket-flip this assertion without checking which code path T1's guard
        // actually intercepts.
        expect(renderedRowCount(container)).toBe(0);
    });
});

describe.skip("setData() segment accumulation (PROVISIONAL - scaffolding for T1, not yet implemented)", () => {
    // TODO(T1): once fetchMoreData/segment plumbing exists, un-skip and adapt these to the
    // real call shape. Do not assume the assertions below are correct as written -- they
    // encode the *behavior* described in the T3 prompt, not verified code.

    it.todo("feeding a second segment appends rows rather than replacing, and total row count is the sum of both segments");

    it.todo(
        "a segment containing rows that belong to an already-expanded group updates that group's " +
            "child rows and subtotal in place, rather than the new rows appearing as ungrouped top-level entries"
    );

    it.todo(
        "an empty/failed segment update preserves hasRenderedRealData-guarded state -- already-rendered rows are NOT wiped " +
            "(contrast with the real, currently-failing case covered above in the non-skipped block)"
    );

    it.todo("once segment.more is false, feeding a further segment does not trigger another fetchMoreData call (end-of-pagination idempotency)");

    it.todo("search/export operate correctly against partial (not-yet-fully-fetched) data without throwing or silently dropping already-loaded rows");
});
