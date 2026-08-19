# apply_module_b_patches.ps1
#
# Applies the Module B (Items 23 + 24) code changes to src\tableRenderer.ts.
#
# Run from the ROOT of the skiba-tables repo, on branch groups-a-e-fetch-more-data.
#
# Safety model: every patch is a literal (non-regex) old-text -> new-text
# replacement. Before writing anything, the script counts how many times each
# old-text block appears in the CURRENT file. If it's not found exactly once
# (i.e. the file has drifted from the verified context this patch was built
# against), the script aborts that patch, reports it, and does NOT touch the
# file for that patch. A .bak backup of the original file is made first
# regardless.

$ErrorActionPreference = "Stop"
$targetPath = ".\src\tableRenderer.ts"

if (-not (Test-Path $targetPath)) {
    Write-Error "Can't find $targetPath -- run this script from the repo root."
    exit 1
}

$backupPath = "$targetPath.module_b.bak"
Copy-Item -Path $targetPath -Destination $backupPath -Force
Write-Host "Backed up original to $backupPath"

$content = Get-Content -Path $targetPath -Raw

function Count-Occurrences {
    param([string]$Haystack, [string]$Needle)
    if ([string]::IsNullOrEmpty($Needle)) { return 0 }
    $count = 0
    $index = 0
    while (($index = $Haystack.IndexOf($Needle, $index, [System.StringComparison]::Ordinal)) -ne -1) {
        $count++
        $index += $Needle.Length
    }
    return $count
}

$patchResults = @()

function Apply-Patch {
    param(
        [string]$Label,
        [string]$Old,
        [string]$New
    )
    # Normalize both anchor and replacement text to CRLF, matching the real
    # source file's line endings -- this script's own here-strings were saved
    # with LF-only endings, which silently mismatched against every anchor.
    $Old = ($Old -replace "`r`n", "`n") -replace "`n", "`r`n"
    $New = ($New -replace "`r`n", "`n") -replace "`n", "`r`n"
    $script:content = $script:content # no-op, keeps scope explicit
    $occurrences = Count-Occurrences -Haystack $script:content -Needle $Old
    if ($occurrences -eq 1) {
        $idx = $script:content.IndexOf($Old, [System.StringComparison]::Ordinal)
        $script:content = $script:content.Substring(0, $idx) + $New + $script:content.Substring($idx + $Old.Length)
        $script:patchResults += [PSCustomObject]@{ Patch = $Label; Status = "APPLIED" }
    } elseif ($occurrences -eq 0) {
        $script:patchResults += [PSCustomObject]@{ Patch = $Label; Status = "SKIPPED - anchor text not found (file has likely changed since this patch was written -- reverify manually)" }
    } else {
        $script:patchResults += [PSCustomObject]@{ Patch = $Label; Status = "SKIPPED - anchor text found $occurrences times (expected exactly 1 -- ambiguous, needs manual review)" }
    }
}

# ---------------------------------------------------------------------------
# Patch 1: new rowCountRoot field declaration (Item 23)
# ---------------------------------------------------------------------------
$old1 = @'
    private scrollRoot!: HTMLDivElement;
    private headerRoot!: HTMLDivElement;
    private bodyRoot!: HTMLDivElement;
    private toolbarRoot!: HTMLDivElement;
    private searchRoot!: HTMLDivElement;
    private pivotChipRoot!: HTMLDivElement;
    private pivotDropRoot!: HTMLDivElement;
    private filterChipsRoot!: HTMLDivElement;
'@

$new1 = @'
    private scrollRoot!: HTMLDivElement;
    private headerRoot!: HTMLDivElement;
    private bodyRoot!: HTMLDivElement;
    private toolbarRoot!: HTMLDivElement;
    private searchRoot!: HTMLDivElement;
    private rowCountRoot!: HTMLDivElement;
    private pivotChipRoot!: HTMLDivElement;
    private pivotDropRoot!: HTMLDivElement;
    private filterChipsRoot!: HTMLDivElement;
'@

Apply-Patch -Label "1. rowCountRoot field declaration" -Old $old1 -New $new1

# ---------------------------------------------------------------------------
# Patch 2: new _fetchMoreFailed private state field (Item 24)
# ---------------------------------------------------------------------------
$old2 = @'
    // Fetch More Data (D1/D2/A1-A4) -----------------------------------------------------
    private _isFetchingMore = false;
    private _hasMoreData = false;
    private _forceFetchAllReason: "search" | "export-csv" | "export-excel" | "export-pdf" | null = null;
    private _scrollListenerAttached = false;
'@

$new2 = @'
    // Fetch More Data (D1/D2/A1-A4) -----------------------------------------------------
    private _isFetchingMore = false;
    private _hasMoreData = false;
    private _fetchMoreFailed = false;
    private _forceFetchAllReason: "search" | "export-csv" | "export-excel" | "export-pdf" | null = null;
    private _scrollListenerAttached = false;
'@

Apply-Patch -Label "2. _fetchMoreFailed state field" -Old $old2 -New $new2

# ---------------------------------------------------------------------------
# Patch 3: create rowCountRoot in buildSkeleton() (Item 23)
# ---------------------------------------------------------------------------
$old3 = @'
        this.searchRoot = document.createElement("div");
        this.searchRoot.className = "skiba-search";
        this.container.appendChild(this.searchRoot);
'@

$new3 = @'
        this.searchRoot = document.createElement("div");
        this.searchRoot.className = "skiba-search";
        this.container.appendChild(this.searchRoot);

        // Item 23: honest row-count display. Deliberately separate from the search/filter
        // match line inside searchRoot (renderStatusLine()), since this must stay visible
        // even when no search term or column filter is active.
        this.rowCountRoot = document.createElement("div");
        this.rowCountRoot.className = "skiba-row-count";
        this.rowCountRoot.setAttribute("role", "status");
        this.rowCountRoot.setAttribute("aria-live", "polite");
        this.container.appendChild(this.rowCountRoot);
'@

Apply-Patch -Label "3. buildSkeleton() rowCountRoot creation" -Old $old3 -New $new3

# ---------------------------------------------------------------------------
# Patch 4: reset _fetchMoreFailed + render row count on every setData() (Items 23/24)
# ---------------------------------------------------------------------------
$old4 = @'
        this._isFetchingMore = false;
        this._hasMoreData = settings.hasMoreData;
        this.renderLoadingMoreIndicator();
'@

$new4 = @'
        this._isFetchingMore = false;
        this._hasMoreData = settings.hasMoreData;
        this._fetchMoreFailed = false;
        this.renderRowCountStatus();
        this.renderLoadingMoreIndicator();
'@

Apply-Patch -Label "4. setData() row-count + failed-state reset" -Old $old4 -New $new4

# ---------------------------------------------------------------------------
# Patch 5: requestMoreData() now handles a rejected (false) fetchMoreData() call (Item 24)
#
# VERIFIED CONTRACT: node_modules\powerbi-visuals-api\src\visuals-api.d.ts line 1717:
#   fetchMoreData: (aggregateSegments?: boolean) => boolean;
# This is SYNCHRONOUS and returns a boolean -- there is no Promise/rejection to catch.
# `false` IS the failure signal, handled inline below rather than via .catch().
# ---------------------------------------------------------------------------
$old5 = @'
    private requestMoreData(): void {
        if (!this._hasMoreData || this._isFetchingMore || this.isExportRestricted()) {
            return;
        }
        if (typeof this.host.fetchMoreData !== "function") {
            return;
        }
        // Explicit `true` (matches the API default) rather than relying on the implicit
        // default, since the whole segment-accumulation design in setData() above depends on
        // Power BI delivering the cumulative merged row set on each continuation, not a raw
        // incremental delta. See FINDINGS.md for the verified source of this contract.
        const accepted = this.host.fetchMoreData(true);
        if (accepted) {
            this._isFetchingMore = true;
            this.renderLoadingMoreIndicator();
        }
    }
'@

$new5 = @'
    private requestMoreData(): void {
        if (!this._hasMoreData || this._isFetchingMore || this.isExportRestricted()) {
            return;
        }
        if (typeof this.host.fetchMoreData !== "function") {
            return;
        }
        this._fetchMoreFailed = false;
        this.renderFetchMoreFailedIndicator();
        // Explicit `true` (matches the API default) rather than relying on the implicit
        // default, since the whole segment-accumulation design in setData() above depends on
        // Power BI delivering the cumulative merged row set on each continuation, not a raw
        // incremental delta. See FINDINGS.md for the verified source of this contract.
        const accepted = this.host.fetchMoreData(true);
        if (accepted) {
            this._isFetchingMore = true;
            this.renderLoadingMoreIndicator();
        } else {
            // host.fetchMoreData() is synchronous and returns a boolean (verified against the
            // real powerbi-visuals-api .d.ts) -- there is no Promise/rejection path. `false` IS
            // the failure signal (e.g. the host rejected the request), so it's handled inline.
            this._fetchMoreFailed = true;
            this.renderFetchMoreFailedIndicator();
        }
    }
'@

Apply-Patch -Label "5. requestMoreData() failure handling" -Old $old5 -New $new5

# ---------------------------------------------------------------------------
# Patch 6: renderLoadingMoreIndicator() also clears any failed indicator, plus adds
# the two new methods renderFetchMoreFailedIndicator() (Item 24) and
# renderRowCountStatus() (Item 23), following the same DOM-creation pattern
# (document.createElement only -- never innerHTML, per the Power BI linter
# no-inner-outer-html -- see clearElement()) and the same keyboard-accessibility
# pattern used elsewhere in the file (tabIndex + role="button" + Enter/Space,
# matching renderGroupByChip()'s chip and the group-row disclosure control).
# ---------------------------------------------------------------------------
$old6 = @'
    private renderLoadingMoreIndicator(): void {
        this.container.querySelectorAll(".skiba-fetch-more-indicator").forEach((el) => el.remove());
        if (!this._isFetchingMore || this._forceFetchAllReason) {
            return;
        }
        const indicator = document.createElement("div");
        indicator.className = "skiba-fetch-more-indicator";
        indicator.setAttribute("role", "status");
        indicator.setAttribute("aria-live", "polite");
        indicator.textContent = this.loc("FetchMore_Loading", "Loading more rows\u2026");
        this.container.appendChild(indicator);
    }
'@

$new6 = @'
    private renderLoadingMoreIndicator(): void {
        this.container.querySelectorAll(".skiba-fetch-more-indicator").forEach((el) => el.remove());
        // A fresh loading attempt (including a retry) supersedes any previously shown failure.
        this.container.querySelectorAll(".skiba-fetch-more-failed").forEach((el) => el.remove());
        if (!this._isFetchingMore || this._forceFetchAllReason) {
            return;
        }
        const indicator = document.createElement("div");
        indicator.className = "skiba-fetch-more-indicator";
        indicator.setAttribute("role", "status");
        indicator.setAttribute("aria-live", "polite");
        indicator.textContent = this.loc("FetchMore_Loading", "Loading more rows\u2026");
        this.container.appendChild(indicator);
    }

    /**
     * Item 24: explicit retry control for a failed Fetch More Data request. Uses the exact
     * same DOM-creation pattern as renderLoadingMoreIndicator() above -- elements built via
     * document.createElement only, never innerHTML (flagged by the Power BI linter
     * no-inner-outer-html even for an empty-string assignment; see clearElement()) -- and the
     * same keyboard-accessibility pattern used elsewhere in this file (tabIndex + role="button"
     * + Enter/Space activation alongside the native click handler, matching the pivot chip in
     * renderGroupByChip() and the group-row disclosure control in renderGroupRow()).
     */
    private renderFetchMoreFailedIndicator(): void {
        this.container.querySelectorAll(".skiba-fetch-more-failed").forEach((el) => el.remove());
        if (!this._fetchMoreFailed || this._forceFetchAllReason) {
            return;
        }

        const wrap = document.createElement("div");
        wrap.className = "skiba-fetch-more-failed";
        wrap.setAttribute("role", "status");
        wrap.setAttribute("aria-live", "assertive");

        const message = document.createElement("span");
        message.textContent = this.loc("Skiba_Visual_FetchMore_Failed", "Couldn't load more rows \u2014");
        wrap.appendChild(message);

        const retryBtn = document.createElement("span");
        retryBtn.className = "skiba-fetch-more-failed__retry";
        const retryLabel = this.loc("Skiba_Visual_FetchMore_Retry", "Retry");
        retryBtn.textContent = retryLabel;
        retryBtn.setAttribute("role", "button");
        retryBtn.tabIndex = 0;
        retryBtn.setAttribute("aria-label", retryLabel);

        const retry = (): void => {
            this.requestMoreData();
        };
        retryBtn.addEventListener("click", retry);
        retryBtn.addEventListener("keydown", (evt: KeyboardEvent) => {
            if (evt.key === "Enter" || evt.key === " ") {
                evt.preventDefault();
                retry();
            }
        });

        wrap.appendChild(document.createTextNode(" "));
        wrap.appendChild(retryBtn);
        this.container.appendChild(wrap);
    }

    /**
     * Item 23: honest row-count display, independent of the search/filter match line in
     * renderStatusLine(). Power BI's Fetch More Data segmentation only ever tells this visual
     * "at least one more segment exists" -- it never provides a true total row count -- so a
     * partial state can only honestly say "{0}+ rows loaded, more available"
     * (Skiba_Visual_RowCount_PartialUnknownTotal), not "{0} of {1}+ loaded"
     * (Skiba_Visual_RowCount_Partial), which would require a second, genuinely-known total this
     * visual does not have. Skiba_Visual_RowCount_Partial is deliberately left unused rather
     * than fed a fabricated second number -- flag this for review if a real total becomes
     * available from elsewhere (e.g. a DAX total-rows measure bound to a new data role).
     */
    private renderRowCountStatus(): void {
        this.clearElement(this.rowCountRoot);
        if (!this.settings) {
            return;
        }
        const count = this._data.length;
        const text = document.createElement("span");
        text.className = "skiba-row-count__text";
        text.textContent = this._hasMoreData
            ? this.loc("Skiba_Visual_RowCount_PartialUnknownTotal", "{0}+ rows loaded, more available", String(count))
            : this.loc("Skiba_Visual_RowCount_Complete", "{0} rows", String(count));
        this.rowCountRoot.appendChild(text);
    }
'@

Apply-Patch -Label "6. renderFetchMoreFailedIndicator() + renderRowCountStatus() (new methods)" -Old $old6 -New $new6

# ---------------------------------------------------------------------------
# Write back only if at least one patch applied; always report status.
# ---------------------------------------------------------------------------
$appliedCount = ($patchResults | Where-Object { $_.Status -eq "APPLIED" }).Count

if ($appliedCount -gt 0) {
    Set-Content -Path $targetPath -Value $content -NoNewline
}

Write-Host ""
Write-Host "===================================================================="
Write-Host "Patch results ($appliedCount of $($patchResults.Count) applied):"
Write-Host "===================================================================="
$patchResults | Format-Table -AutoSize -Wrap

if ($appliedCount -lt $patchResults.Count) {
    Write-Host ""
    Write-Host "One or more patches were SKIPPED. The file was still updated with" -ForegroundColor Yellow
    Write-Host "whichever patches DID apply cleanly. Review the skipped patches above" -ForegroundColor Yellow
    Write-Host "and either apply them by hand or paste the new tableRenderer.ts back" -ForegroundColor Yellow
    Write-Host "for re-verification -- do not assume they don't matter." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Original file backed up at: $backupPath"
Write-Host "Next: npx tsc --noEmit -p .    then    npx jest"
