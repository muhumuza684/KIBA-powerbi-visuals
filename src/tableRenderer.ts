"use strict";

import * as d3 from "d3";
import * as XLSX from "xlsx";
import powerbi from "powerbi-visuals-api";
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionId = powerbi.visuals.ISelectionId;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ITooltipService = powerbi.extensibility.ITooltipService;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

/** A single logical column: either a plain row dimension or a value measure. */
export interface ITableColumn {
    name: string;
    displayName: string;
    isMeasure: boolean;
    isGroupBy: boolean;
}

/** A single flattened data row, keyed by column name. */
export interface ITableRow {
    key: string;
    values: { [columnName: string]: powerbi.PrimitiveValue };
    selectionId: ISelectionId;
}

export interface ITableRendererSettings {
    fontFamily: string;
    fontSize: number;
    rowHeight: number;
    headerBg: string;
    headerFont: string;
    headerBold: boolean;
    cellBg: string;
    cellFont: string;
    altRow: string;
    enableDataBars: boolean;
    barColor: string;
    showTotals: boolean;
    totalsLabel: string;
    totalsBg: string;
    virtualScrollEnabled: boolean;
    virtualScrollRowHeight: number;
    showToolbar: boolean;
    searchEnabled: boolean;
    enableColumnFilters: boolean;
    conditionalFormatEnabled: boolean;
    conditionalFormatMinColor: string;
    conditionalFormatMaxColor: string;
    groupsDefaultExpanded: boolean;
}

type SortDirection = "asc" | "desc" | "none";

interface ISortState {
    column: string | null;
    direction: SortDirection;
}

type FilterType = "text" | "number" | "date";
type FilterOperator = "contains" | "equals" | "gt" | "gte" | "lt" | "lte" | "between";

interface IColumnFilter {
    type: FilterType;
    operator: FilterOperator;
    value: string;
    value2?: string;
}

/** One row of the (post-filter, post-sort) flattened render list: either a group header or a leaf data row. */
type RenderNode =
    | { kind: "group"; depth: number; path: string; column: ITableColumn; value: powerbi.PrimitiveValue; count: number; sums: Map<string, number> }
    | { kind: "row"; depth: number; row: ITableRow };

const ROW_BUFFER = 6; // extra rows rendered above/below viewport to avoid flicker while scrolling
const GROUP_SEP = "\u241F"; // unit separator — safe delimiter for building unique group path keys

/**
 * TableRenderer owns everything that happens inside the scrollable table
 * surface: virtualization, multi-level grouping/drill-down, sorting,
 * per-column + global search filtering, column resize/reorder, cross-filter
 * selection, data bars, conditional (value-based) formatting, smart
 * tooltips, and CSV/Excel/PDF export.
 */
export class TableRenderer {
    private container: HTMLDivElement;
    private host: IVisualHost;
    private selectionManager: ISelectionManager;
    private tooltipService: ITooltipService;

    private settings!: ITableRendererSettings;
    private columns: ITableColumn[] = [];
    private rowColumns: ITableColumn[] = [];
    private groupColumns: ITableColumn[] = [];
    private valueColumns: ITableColumn[] = [];

    private _data: ITableRow[] = [];
    private _filteredData: ITableRow[] = [];
    private _renderNodes: RenderNode[] = [];
    private _groupExpansion: Map<string, boolean> = new Map();
    private _sortState: ISortState = { column: null, direction: "none" };
    private _searchTerm: string = "";
    private _columnWidths: Map<string, number> = new Map();
    private _hiddenColumns: Set<string> = new Set();
    private _columnOrder: string[] = [];
    private _columnFilters: Map<string, IColumnFilter> = new Map();
    private _columnStats: Map<string, { mean: number; deviation: number }> = new Map();
    private _columnMinMax: Map<string, { min: number; max: number }> = new Map();
    private columnMaxCache: Map<string, number> = new Map();

    private scrollRoot!: HTMLDivElement;
    private headerRoot!: HTMLDivElement;
    private bodyRoot!: HTMLDivElement;
    private toolbarRoot!: HTMLDivElement;
    private searchRoot!: HTMLDivElement;
    private filterChipsRoot!: HTMLDivElement;

    private defaultRowHeight = 32;

    constructor(container: HTMLDivElement, host: IVisualHost, selectionManager: ISelectionManager, tooltipService: ITooltipService) {
        this.container = container;
        this.host = host;
        this.selectionManager = selectionManager;
        this.tooltipService = tooltipService;

        this.container.classList.add("skiba-table-root");
        this.buildSkeleton();
    }

    /** Builds the static DOM skeleton once: toolbar, search bar, filter chip strip, header, scroll body. */
    private buildSkeleton(): void {
        this.container.innerHTML = "";

        this.toolbarRoot = document.createElement("div");
        this.toolbarRoot.className = "skiba-toolbar";
        this.container.appendChild(this.toolbarRoot);

        this.searchRoot = document.createElement("div");
        this.searchRoot.className = "skiba-search";
        this.container.appendChild(this.searchRoot);

        this.filterChipsRoot = document.createElement("div");
        this.filterChipsRoot.className = "skiba-filter-chips";
        this.container.appendChild(this.filterChipsRoot);

        const tableWrap = document.createElement("div");
        tableWrap.className = "skiba-table";
        this.container.appendChild(tableWrap);

        this.headerRoot = document.createElement("div");
        this.headerRoot.className = "skiba-table__header";
        tableWrap.appendChild(this.headerRoot);

        this.scrollRoot = document.createElement("div");
        this.scrollRoot.className = "skiba-table__scroll";
        tableWrap.appendChild(this.scrollRoot);

        this.bodyRoot = document.createElement("div");
        this.bodyRoot.className = "skiba-table__body";
        this.scrollRoot.appendChild(this.bodyRoot);

        this.scrollRoot.addEventListener("scroll", () => this.renderVisibleRows());
    }

    /** Replaces the dataset and columns, resets derived (filtered/sorted/grouped) state, and renders. */
    public setData(
        rowColumns: ITableColumn[],
        groupColumns: ITableColumn[],
        valueColumns: ITableColumn[],
        data: ITableRow[],
        settings: ITableRendererSettings
    ): void {
        this.rowColumns = rowColumns;
        this.groupColumns = groupColumns;
        this.valueColumns = valueColumns;
        this.columns = [...rowColumns, ...valueColumns];
        this._data = data;
        this.settings = settings;
        this.defaultRowHeight = settings.virtualScrollEnabled ? settings.virtualScrollRowHeight : settings.rowHeight;

        // Preserve any custom order the user already set; append newly-seen columns at the end,
        // and drop any that disappeared (e.g. a field was removed from the visual).
        const knownNames = new Set(this._columnOrder);
        this.columns.forEach((c) => {
            if (!knownNames.has(c.name)) {
                this._columnOrder.push(c.name);
            }
        });
        this._columnOrder = this._columnOrder.filter((name) => this.columns.some((c) => c.name === name));

        this.computeColumnStats();
        this.applyPipeline();
        this.render();
    }

    /** Full re-render: toolbar, search bar, filter chips, header row, and the virtualized body. */
    private render(): void {
        this.applyThemeVars();
        this.renderToolbar();
        this.renderSearchBar();
        this.renderFilterChips();
        this.renderHeader();
        this.renderVisibleRows();
    }

    private applyThemeVars(): void {
        const root = this.container;
        root.style.setProperty("--skiba-font-family", this.settings.fontFamily);
        root.style.setProperty("--skiba-font-size", `${this.settings.fontSize}px`);
        root.style.setProperty("--skiba-row-height", `${this.defaultRowHeight}px`);
        root.style.setProperty("--skiba-header-bg", this.settings.headerBg);
        root.style.setProperty("--skiba-header-font", this.settings.headerFont);
        root.style.setProperty("--skiba-header-weight", this.settings.headerBold ? "600" : "400");
        root.style.setProperty("--skiba-cell-bg", this.settings.cellBg);
        root.style.setProperty("--skiba-cell-font", this.settings.cellFont);
        root.style.setProperty("--skiba-alt-row", this.settings.altRow);
        root.style.setProperty("--skiba-bar-color", this.settings.barColor);
        root.style.setProperty("--skiba-totals-bg", this.settings.totalsBg);
    }

    // -----------------------------------------------------------------
    // Toolbar (minimal floating menu — progressive disclosure)
    // -----------------------------------------------------------------

    private renderToolbar(): void {
        this.toolbarRoot.innerHTML = "";
        this.toolbarRoot.style.display = this.settings.showToolbar ? "" : "none";
        if (!this.settings.showToolbar) {
            return;
        }

        const hamburger = document.createElement("button");
        hamburger.className = "skiba-hamburger";
        hamburger.setAttribute("aria-label", "Table options");
        hamburger.setAttribute("aria-haspopup", "true");
        hamburger.title = "Table options";
        hamburger.textContent = "\u2699\uFE0F"; // gear icon
        this.toolbarRoot.appendChild(hamburger);

        const menu = document.createElement("div");
        menu.className = "skiba-toolbar__menu";
        menu.setAttribute("role", "menu");
        menu.style.display = "none";
        this.toolbarRoot.appendChild(menu);

        const closeMenu = (): void => {
            menu.style.display = "none";
        };

        hamburger.addEventListener("click", (evt) => {
            evt.stopPropagation();
            menu.style.display = menu.style.display === "none" ? "block" : "none";
        });
        document.addEventListener("click", closeMenu);

        // Column visibility toggles
        const columnsSection = document.createElement("div");
        columnsSection.className = "skiba-toolbar__section";
        const columnsTitle = document.createElement("div");
        columnsTitle.className = "skiba-toolbar__section-title";
        columnsTitle.textContent = "Show columns";
        columnsSection.appendChild(columnsTitle);

        this.columns.forEach((col) => {
            const label = document.createElement("label");
            label.className = "skiba-toolbar__checkbox";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = !this._hiddenColumns.has(col.name);
            checkbox.addEventListener("change", () => {
                if (checkbox.checked) {
                    this._hiddenColumns.delete(col.name);
                } else {
                    this._hiddenColumns.add(col.name);
                }
                this.renderHeader();
                this.renderVisibleRows();
            });
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(col.displayName));
            columnsSection.appendChild(label);
        });
        menu.appendChild(columnsSection);
        menu.appendChild(this.makeDivider());

        if (this.groupColumns.length > 0) {
            menu.appendChild(this.makeMenuButton("Expand all groups", () => {
                this.expandAllGroups();
                closeMenu();
            }));
            menu.appendChild(this.makeMenuButton("Collapse all groups", () => {
                this.collapseAllGroups();
                closeMenu();
            }));
            menu.appendChild(this.makeDivider());
        }

        menu.appendChild(this.makeMenuButton("Export CSV", () => this.exportCSV()));
        menu.appendChild(this.makeMenuButton("Export Excel", () => this.exportExcel()));
        menu.appendChild(this.makeMenuButton("Export PDF", () => this.exportPDF()));
        menu.appendChild(this.makeDivider());

        // Reset sorts / filters — harmless, no confirmation needed
        menu.appendChild(this.makeMenuButton("Reset sorts", () => {
            this.resetSorts();
            closeMenu();
        }));
        menu.appendChild(this.makeMenuButton("Reset filters", () => {
            this._columnFilters.clear();
            this.commitFilterChange();
            closeMenu();
        }));

        // Reset column widths / order — discards user customization, so confirm first
        menu.appendChild(this.makeMenuButton("Reset column widths", () => {
            if (this._columnWidths.size === 0) {
                this.resetColumnWidths();
                closeMenu();
                return;
            }
            if (window.confirm("This will discard your custom column widths. Continue?")) {
                this.resetColumnWidths();
            }
            closeMenu();
        }));
        menu.appendChild(this.makeMenuButton("Reset column order", () => {
            const doReset = () => {
                this._columnOrder = this.columns.map((c) => c.name);
                this.renderHeader();
                this.renderVisibleRows();
            };
            if (window.confirm("This will restore the original column order. Continue?")) {
                doReset();
            }
            closeMenu();
        }));
    }

    private makeDivider(): HTMLDivElement {
        const divider = document.createElement("div");
        divider.className = "skiba-toolbar__divider";
        return divider;
    }

    private makeMenuButton(label: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement("button");
        btn.className = "skiba-toolbar__button";
        btn.textContent = label;
        btn.setAttribute("role", "menuitem");
        btn.addEventListener("click", (evt) => {
            evt.stopPropagation();
            onClick();
        });
        return btn;
    }

    // -----------------------------------------------------------------
    // Search
    // -----------------------------------------------------------------

    private renderSearchBar(): void {
        this.searchRoot.innerHTML = "";
        this.searchRoot.style.display = this.settings.searchEnabled ? "" : "none";
        if (!this.settings.searchEnabled) {
            return;
        }

        const input = document.createElement("input");
        input.type = "text";
        input.className = "skiba-search__input";
        input.placeholder = "Search this table";
        input.setAttribute("aria-label", "Search this table");
        input.value = this._searchTerm;
        input.addEventListener("input", () => {
            this._searchTerm = input.value;
            this.applyPipeline();
            this.renderVisibleRows();
            this.renderStatusLine();
        });
        this.searchRoot.appendChild(input);

        const status = document.createElement("span");
        status.className = "skiba-search__status";
        this.searchRoot.appendChild(status);
        this.renderStatusLine();
    }

    private renderStatusLine(): void {
        const status = this.searchRoot.querySelector<HTMLSpanElement>(".skiba-search__status");
        if (!status) {
            return;
        }
        if (this._searchTerm.trim().length === 0 && this._columnFilters.size === 0) {
            status.textContent = "";
            return;
        }
        status.textContent = `${this._filteredData.length} of ${this._data.length} rows match`;
    }

    // -----------------------------------------------------------------
    // Per-column filters (header-driven popover) + filter chip strip
    // -----------------------------------------------------------------

    private inferFilterType(col: ITableColumn): FilterType {
        const sample = this._data.find((r) => r.values[col.name] !== null && r.values[col.name] !== undefined);
        const v = sample ? sample.values[col.name] : undefined;
        if (typeof v === "number") {
            return "number";
        }
        if (v instanceof Date) {
            return "date";
        }
        return "text";
    }

    private openFilterPopover(col: ITableColumn, anchor: HTMLElement): void {
        this.container.querySelectorAll(".skiba-filter-popover").forEach((el) => el.remove());

        const type = this.inferFilterType(col);
        const existing = this._columnFilters.get(col.name);
        const popover = document.createElement("div");
        popover.className = "skiba-filter-popover";

        const applyAndCommit = (filter: IColumnFilter | null): void => {
            if (filter) {
                this._columnFilters.set(col.name, filter);
            } else {
                this._columnFilters.delete(col.name);
            }
            this.commitFilterChange();
        };

        if (type === "text") {
            const input = document.createElement("input");
            input.type = "text";
            input.placeholder = "Contains...";
            input.value = existing?.value ?? "";
            popover.appendChild(input);

            const apply = (): void => {
                applyAndCommit(input.value.trim().length === 0 ? null : { type: "text", operator: "contains", value: input.value });
            };
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    apply();
                    popover.remove();
                }
            });
            popover.appendChild(this.filterActionsRow(apply, () => applyAndCommit(null), popover));
        } else if (type === "number") {
            const opSelect = document.createElement("select");
            const opLabels: Record<FilterOperator, string> = { equals: "=", gt: ">", gte: "\u2265", lt: "<", lte: "\u2264", between: "between", contains: "contains" };
            (["equals", "gt", "gte", "lt", "lte", "between"] as FilterOperator[]).forEach((op) => {
                const o = document.createElement("option");
                o.value = op;
                o.textContent = opLabels[op];
                if (existing?.operator === op) {
                    o.selected = true;
                }
                opSelect.appendChild(o);
            });
            popover.appendChild(opSelect);

            const val1 = document.createElement("input");
            val1.type = "number";
            val1.value = existing?.value ?? "";
            popover.appendChild(val1);

            const val2 = document.createElement("input");
            val2.type = "number";
            val2.placeholder = "and";
            val2.value = existing?.value2 ?? "";
            val2.style.display = opSelect.value === "between" ? "" : "none";
            popover.appendChild(val2);

            opSelect.addEventListener("change", () => {
                val2.style.display = opSelect.value === "between" ? "" : "none";
            });

            const apply = (): void => {
                applyAndCommit(val1.value.trim().length === 0 ? null : {
                    type: "number",
                    operator: opSelect.value as FilterOperator,
                    value: val1.value,
                    value2: val2.value
                });
            };
            popover.appendChild(this.filterActionsRow(apply, () => applyAndCommit(null), popover));
        } else {
            const from = document.createElement("input");
            from.type = "date";
            from.value = existing?.value ?? "";
            popover.appendChild(from);
            const to = document.createElement("input");
            to.type = "date";
            to.value = existing?.value2 ?? "";
            popover.appendChild(to);

            const apply = (): void => {
                applyAndCommit((!from.value && !to.value) ? null : { type: "date", operator: "between", value: from.value, value2: to.value });
            };
            popover.appendChild(this.filterActionsRow(apply, () => applyAndCommit(null), popover));
        }

        const rect = anchor.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        popover.style.left = `${rect.left - containerRect.left}px`;
        popover.style.top = `${rect.bottom - containerRect.top}px`;
        this.container.appendChild(popover);

        const dismiss = (evt: MouseEvent): void => {
            if (!popover.contains(evt.target as Node) && evt.target !== anchor) {
                popover.remove();
                document.removeEventListener("click", dismiss);
            }
        };
        setTimeout(() => document.addEventListener("click", dismiss), 0);
    }

    private filterActionsRow(onApply: () => void, onClear: () => void, popover: HTMLDivElement): HTMLDivElement {
        const row = document.createElement("div");
        row.className = "skiba-filter-popover__actions";
        const clearBtn = document.createElement("button");
        clearBtn.textContent = "Clear";
        clearBtn.addEventListener("click", () => {
            onClear();
            popover.remove();
        });
        const applyBtn = document.createElement("button");
        applyBtn.textContent = "Apply";
        applyBtn.addEventListener("click", () => {
            onApply();
            popover.remove();
        });
        row.appendChild(clearBtn);
        row.appendChild(applyBtn);
        return row;
    }

    private commitFilterChange(): void {
        this.applyPipeline();
        this.renderHeader();
        this.renderFilterChips();
        this.renderVisibleRows();
        this.renderStatusLine();
    }

    private renderFilterChips(): void {
        this.filterChipsRoot.innerHTML = "";
        if (this._columnFilters.size === 0) {
            this.filterChipsRoot.style.display = "none";
            return;
        }
        this.filterChipsRoot.style.display = "";

        this._columnFilters.forEach((filter, colName) => {
            const col = this.columns.find((c) => c.name === colName);
            const label = col ? col.displayName : colName;
            const opLabels: Record<FilterOperator, string> = { equals: "=", gt: ">", gte: "\u2265", lt: "<", lte: "\u2264", between: "between", contains: "contains" };
            const desc = filter.type === "text"
                ? `contains "${filter.value}"`
                : filter.type === "date"
                    ? `${filter.value || "..."} \u2192 ${filter.value2 || "..."}`
                    : `${opLabels[filter.operator]} ${filter.value}${filter.operator === "between" ? ` and ${filter.value2}` : ""}`;

            const chip = document.createElement("span");
            chip.className = "skiba-filter-chip";
            chip.textContent = `${label}: ${desc}`;

            const remove = document.createElement("button");
            remove.className = "skiba-filter-chip__remove";
            remove.textContent = "\u00D7";
            remove.setAttribute("aria-label", `Remove filter on ${label}`);
            remove.addEventListener("click", () => {
                this._columnFilters.delete(colName);
                this.commitFilterChange();
            });
            chip.appendChild(remove);
            this.filterChipsRoot.appendChild(chip);
        });
    }

    // -----------------------------------------------------------------
    // Header (sorting, resizing, drag-to-reorder, filter icon)
    // -----------------------------------------------------------------

    private visibleColumns(): ITableColumn[] {
        return this._columnOrder
            .map((name) => this.columns.find((c) => c.name === name))
            .filter((c): c is ITableColumn => !!c && !this._hiddenColumns.has(c.name));
    }

    private columnWidth(col: ITableColumn): number {
        return this._columnWidths.get(col.name) ?? 150;
    }

    private renderHeader(): void {
        this.headerRoot.innerHTML = "";
        const row = document.createElement("div");
        row.className = "skiba-table__row skiba-table__row--header";
        row.setAttribute("role", "row");

        this.visibleColumns().forEach((col) => {
            const th = document.createElement("div");
            th.className = "skiba-table__cell skiba-table__cell--header";
            th.setAttribute("role", "columnheader");
            th.style.width = `${this.columnWidth(col)}px`;
            th.tabIndex = 0;
            th.setAttribute("aria-sort", this.ariaSortFor(col.name));
            th.draggable = true;

            th.addEventListener("dragstart", (evt: DragEvent) => {
                evt.dataTransfer?.setData("text/skiba-column", col.name);
                th.classList.add("skiba-table__cell--dragging");
            });
            th.addEventListener("dragend", () => th.classList.remove("skiba-table__cell--dragging"));
            th.addEventListener("dragover", (evt: DragEvent) => evt.preventDefault());
            th.addEventListener("drop", (evt: DragEvent) => {
                evt.preventDefault();
                const draggedName = evt.dataTransfer?.getData("text/skiba-column");
                if (!draggedName || draggedName === col.name) {
                    return;
                }
                this.reorderColumn(draggedName, col.name);
            });

            const label = document.createElement("span");
            label.className = "skiba-table__header-label";
            label.textContent = col.displayName;
            th.appendChild(label);

            if (this._sortState.column === col.name && this._sortState.direction !== "none") {
                const arrow = document.createElement("span");
                arrow.className = "skiba-table__sort-arrow";
                arrow.textContent = this._sortState.direction === "asc" ? "\u25B2" : "\u25BC";
                th.appendChild(arrow);
            }

            if (this.settings.enableColumnFilters) {
                const filterBtn = document.createElement("button");
                filterBtn.className = "skiba-filter-icon";
                filterBtn.classList.toggle("skiba-filter-icon--active", this._columnFilters.has(col.name));
                filterBtn.textContent = "\u25BE";
                filterBtn.setAttribute("aria-label", `Filter ${col.displayName}`);
                filterBtn.addEventListener("click", (evt) => {
                    evt.stopPropagation();
                    this.openFilterPopover(col, filterBtn);
                });
                th.appendChild(filterBtn);
            }

            const activate = (): void => this.cycleSort(col.name);
            label.addEventListener("click", activate);
            th.addEventListener("keydown", (evt: KeyboardEvent) => {
                if (evt.key === "Enter" || evt.key === " ") {
                    evt.preventDefault();
                    activate();
                }
            });

            const resizer = document.createElement("div");
            resizer.className = "skiba-resizer";
            resizer.setAttribute("aria-hidden", "true");
            this.attachResizeDrag(resizer, col);
            th.appendChild(resizer);

            row.appendChild(th);
        });

        this.headerRoot.appendChild(row);
    }

    /** Moves `draggedName` to sit at `targetName`'s current position. */
    private reorderColumn(draggedName: string, targetName: string): void {
        const from = this._columnOrder.indexOf(draggedName);
        const to = this._columnOrder.indexOf(targetName);
        if (from === -1 || to === -1) {
            return;
        }
        this._columnOrder.splice(from, 1);
        this._columnOrder.splice(to, 0, draggedName);
        this.renderHeader();
        this.renderVisibleRows();
    }

    private ariaSortFor(columnName: string): "ascending" | "descending" | "none" {
        if (this._sortState.column !== columnName) {
            return "none";
        }
        if (this._sortState.direction === "asc") {
            return "ascending";
        }
        if (this._sortState.direction === "desc") {
            return "descending";
        }
        return "none";
    }

    /** Clicking a header cycles Ascending -> Descending -> None, with a visible arrow at every step. */
    private cycleSort(columnName: string): void {
        if (this._sortState.column !== columnName) {
            this._sortState = { column: columnName, direction: "asc" };
        } else if (this._sortState.direction === "asc") {
            this._sortState = { column: columnName, direction: "desc" };
        } else if (this._sortState.direction === "desc") {
            this._sortState = { column: null, direction: "none" };
        } else {
            this._sortState = { column: columnName, direction: "asc" };
        }
        this.applyPipeline();
        this.renderHeader();
        this.renderVisibleRows();
    }

    private resetSorts(): void {
        this._sortState = { column: null, direction: "none" };
        this.applyPipeline();
        this.renderHeader();
        this.renderVisibleRows();
    }

    private resetColumnWidths(): void {
        this._columnWidths.clear();
        this.renderHeader();
        this.renderVisibleRows();
    }

    private attachResizeDrag(handle: HTMLDivElement, col: ITableColumn): void {
        d3.select(handle).call(
            d3
                .drag<HTMLDivElement, unknown>()
                .on("start", (event: d3.D3DragEvent<HTMLDivElement, unknown, unknown>) => {
                    (event.sourceEvent as Event).stopPropagation();
                    handle.classList.add("skiba-resizer--active");
                })
                .on("drag", (event: d3.D3DragEvent<HTMLDivElement, unknown, unknown>) => {
                    const current = this.columnWidth(col);
                    const next = Math.max(60, current + event.dx);
                    this._columnWidths.set(col.name, next);
                    this.renderHeader();
                    this.renderVisibleRows();
                })
                .on("end", () => {
                    handle.classList.remove("skiba-resizer--active");
                })
        );
    }

    // -----------------------------------------------------------------
    // Filter / search / sort / group pipeline
    // -----------------------------------------------------------------

    private matchesColumnFilter(row: ITableRow, colName: string, filter: IColumnFilter): boolean {
        const raw = row.values[colName];

        if (filter.type === "text") {
            if (raw === null || raw === undefined) {
                return false;
            }
            return String(raw).toLowerCase().includes(filter.value.toLowerCase());
        }

        if (filter.type === "number") {
            if (typeof raw !== "number") {
                return false;
            }
            const v1 = parseFloat(filter.value);
            switch (filter.operator) {
                case "between": {
                    const v2 = parseFloat(filter.value2 ?? filter.value);
                    return raw >= Math.min(v1, v2) && raw <= Math.max(v1, v2);
                }
                case "equals": return raw === v1;
                case "gt": return raw > v1;
                case "gte": return raw >= v1;
                case "lt": return raw < v1;
                case "lte": return raw <= v1;
                default: return true;
            }
        }

        // date
        const rawDate = raw instanceof Date ? raw : (typeof raw === "string" ? new Date(raw) : null);
        if (!rawDate || isNaN(rawDate.getTime())) {
            return false;
        }
        if (filter.value) {
            const from = new Date(filter.value);
            if (rawDate < from) {
                return false;
            }
        }
        if (filter.value2) {
            const to = new Date(filter.value2);
            if (rawDate > to) {
                return false;
            }
        }
        return true;
    }

    private applyPipeline(): void {
        let rows = this._data;

        this._columnFilters.forEach((filter, colName) => {
            rows = rows.filter((row) => this.matchesColumnFilter(row, colName, filter));
        });

        const term = this._searchTerm.trim().toLowerCase();
        if (term.length > 0) {
            rows = rows.filter((row) =>
                this.columns.some((col) => {
                    const v = row.values[col.name];
                    return v !== null && v !== undefined && String(v).toLowerCase().includes(term);
                })
            );
        }

        if (this._sortState.column && this._sortState.direction !== "none") {
            const col = this._sortState.column;
            const dir = this._sortState.direction === "asc" ? 1 : -1;
            rows = [...rows].sort((a, b) => {
                const av = a.values[col];
                const bv = b.values[col];
                if (av === null || av === undefined) return 1;
                if (bv === null || bv === undefined) return -1;
                if (typeof av === "number" && typeof bv === "number") {
                    return (av - bv) * dir;
                }
                return String(av).localeCompare(String(bv)) * dir;
            });
        }

        this._filteredData = rows;
        this._renderNodes = this.groupColumns.length > 0
            ? this.buildGroupedNodes(rows)
            : rows.map((r) => ({ kind: "row", depth: 0, row: r } as RenderNode));
    }

    // -----------------------------------------------------------------
    // Grouping / drill-down
    // -----------------------------------------------------------------

    private bucketRows(rows: ITableRow[], col: ITableColumn): Map<string, ITableRow[]> {
        const buckets = new Map<string, ITableRow[]>();
        rows.forEach((r) => {
            const raw = r.values[col.name];
            const key = raw === null || raw === undefined ? "(blank)" : String(raw);
            const arr = buckets.get(key);
            if (arr) {
                arr.push(r);
            } else {
                buckets.set(key, [r]);
            }
        });
        return buckets;
    }

    /** Recursively groups by each "Group by" role column, in order, producing a flat list of group + row nodes. */
    private buildGroupedNodes(rows: ITableRow[]): RenderNode[] {
        const nodes: RenderNode[] = [];

        const recurse = (subRows: ITableRow[], depth: number, prefix: string): void => {
            if (depth >= this.groupColumns.length) {
                subRows.forEach((r) => nodes.push({ kind: "row", depth, row: r }));
                return;
            }

            const col = this.groupColumns[depth];
            const buckets = this.bucketRows(subRows, col);

            buckets.forEach((bucketRows, key) => {
                const path = prefix + GROUP_SEP + col.name + "=" + key;

                const sums = new Map<string, number>();
                this.valueColumns.forEach((vc) => {
                    const total = d3.sum(bucketRows, (r) => {
                        const v = r.values[vc.name];
                        return typeof v === "number" ? v : 0;
                    });
                    sums.set(vc.name, total);
                });

                if (!this._groupExpansion.has(path)) {
                    this._groupExpansion.set(path, this.settings.groupsDefaultExpanded);
                }

                const rawValue = bucketRows[0].values[col.name];
                nodes.push({ kind: "group", depth, path, column: col, value: rawValue, count: bucketRows.length, sums });

                if (this._groupExpansion.get(path)) {
                    recurse(bucketRows, depth + 1, path);
                }
            });
        };

        recurse(rows, 0, "");
        return nodes;
    }

    private toggleGroup(path: string): void {
        const current = this._groupExpansion.get(path) ?? this.settings.groupsDefaultExpanded;
        this._groupExpansion.set(path, !current);
        this.applyPipeline();
        this.renderVisibleRows();
    }

    /** Walks the full (unfiltered-by-collapse) group tree, forcing every path's expansion state. */
    private setAllGroupsExpansion(expanded: boolean): void {
        const walk = (rows: ITableRow[], depth: number, prefix: string): void => {
            if (depth >= this.groupColumns.length) {
                return;
            }
            const col = this.groupColumns[depth];
            const buckets = this.bucketRows(rows, col);
            buckets.forEach((bucketRows, key) => {
                const path = prefix + GROUP_SEP + col.name + "=" + key;
                this._groupExpansion.set(path, expanded);
                walk(bucketRows, depth + 1, path);
            });
        };
        walk(this._filteredData, 0, "");
        this.applyPipeline();
        this.renderVisibleRows();
    }

    private expandAllGroups(): void {
        this.setAllGroupsExpansion(true);
    }

    private collapseAllGroups(): void {
        this.setAllGroupsExpansion(false);
    }

    // -----------------------------------------------------------------
    // Virtual scrolling body
    // -----------------------------------------------------------------

    private renderVisibleRows(): void {
        const rowHeight = this.defaultRowHeight;
        const nodes = this._renderNodes;
        const totalRows = nodes.length;

        if (totalRows === 0) {
            this.bodyRoot.innerHTML = "";
            const empty = document.createElement("div");
            empty.className = "skiba-table__empty-filter";
            empty.textContent = (this._searchTerm.trim().length > 0 || this._columnFilters.size > 0)
                ? "No rows match your search or filters."
                : "No data to display.";
            this.bodyRoot.appendChild(empty);
            this.bodyRoot.style.height = "auto";
            return;
        }

        const viewportHeight = this.scrollRoot.clientHeight || 400;
        const scrollTop = this.scrollRoot.scrollTop;

        const visibleRowCount = Math.ceil(viewportHeight / rowHeight) + ROW_BUFFER;
        const startIndex = this.settings.virtualScrollEnabled
            ? Math.max(0, Math.floor(scrollTop / rowHeight) - Math.floor(ROW_BUFFER / 2))
            : 0;
        const endIndex = this.settings.virtualScrollEnabled
            ? Math.min(totalRows, startIndex + visibleRowCount)
            : totalRows;

        const topSpacerHeight = startIndex * rowHeight;
        const bottomSpacerHeight = (totalRows - endIndex) * rowHeight;

        this.bodyRoot.innerHTML = "";
        this.bodyRoot.style.position = "relative";

        const topSpacer = document.createElement("div");
        topSpacer.style.height = `${topSpacerHeight}px`;
        topSpacer.style.flexShrink = "0";
        this.bodyRoot.appendChild(topSpacer);

        const visibleColumns = this.visibleColumns();
        const selectedIds = this.selectionManager.getSelectionIds() as ISelectionId[];

        for (let i = startIndex; i < endIndex; i++) {
            const node = nodes[i];
            if (node.kind === "group") {
                this.bodyRoot.appendChild(this.renderGroupRow(node, visibleColumns, rowHeight));
            } else {
                this.bodyRoot.appendChild(this.renderRow(node.row, node.depth, i, visibleColumns, selectedIds, rowHeight));
            }
        }

        const bottomSpacer = document.createElement("div");
        bottomSpacer.style.height = `${bottomSpacerHeight}px`;
        bottomSpacer.style.flexShrink = "0";
        this.bodyRoot.appendChild(bottomSpacer);

        if (this.settings.showTotals) {
            this.bodyRoot.appendChild(this.renderTotalsRow(visibleColumns, rowHeight));
        }
    }

    private renderGroupRow(node: Extract<RenderNode, { kind: "group" }>, visibleColumns: ITableColumn[], rowHeight: number): HTMLDivElement {
        const rowEl = document.createElement("div");
        rowEl.className = "skiba-table__row skiba-table__row--group";
        rowEl.style.height = `${rowHeight}px`;
        rowEl.setAttribute("role", "row");

        const isExpanded = this._groupExpansion.get(node.path) ?? this.settings.groupsDefaultExpanded;

        const chevron = document.createElement("span");
        chevron.className = "skiba-group__chevron";
        chevron.textContent = isExpanded ? "\u25BC" : "\u25B6";
        chevron.style.marginLeft = `${node.depth * 16}px`;

        const label = document.createElement("span");
        label.className = "skiba-group__label";
        const valueText = node.value === null || node.value === undefined ? "(blank)" : String(node.value);
        label.textContent = `${node.column.displayName}: ${valueText} (${node.count})`;

        const head = document.createElement("div");
        head.className = "skiba-table__cell skiba-table__cell--group-label";
        head.appendChild(chevron);
        head.appendChild(label);
        rowEl.appendChild(head);

        rowEl.addEventListener("click", () => this.toggleGroup(node.path));

        // Aggregate sums for measure columns, aligned like a mini totals strip on the group row.
        visibleColumns.filter((c) => c.isMeasure).forEach((col) => {
            const cell = document.createElement("div");
            cell.className = "skiba-table__cell skiba-table__cell--group-sum";
            cell.style.width = `${this.columnWidth(col)}px`;
            const sum = node.sums.get(col.name) ?? 0;
            cell.textContent = this.formatNumber(sum);
            rowEl.appendChild(cell);
        });

        return rowEl;
    }

    private renderRow(
        row: ITableRow,
        depth: number,
        index: number,
        visibleColumns: ITableColumn[],
        selectedIds: ISelectionId[],
        rowHeight: number
    ): HTMLDivElement {
        const rowEl = document.createElement("div");
        rowEl.className = "skiba-table__row";
        rowEl.style.height = `${rowHeight}px`;
        rowEl.setAttribute("role", "row");
        rowEl.classList.toggle("skiba-table__row--alt", index % 2 === 1);

        const isSelected = selectedIds.some((id) => id.equals(row.selectionId));
        rowEl.classList.toggle("skiba-table__row--selected", isSelected);

        rowEl.addEventListener("click", (evt: MouseEvent) => {
            const multiSelect = evt.ctrlKey || evt.metaKey;
            this.selectionManager.select(row.selectionId, multiSelect).then(() => {
                this.renderVisibleRows();
            });
        });

        rowEl.addEventListener("mouseenter", (evt: MouseEvent) => this.showRowTooltip(row, evt));
        rowEl.addEventListener("mousemove", (evt: MouseEvent) => this.moveTooltip(evt));
        rowEl.addEventListener("mouseleave", () => this.hideTooltip());

        visibleColumns.forEach((col, idx) => {
            const cell = this.renderCell(row, col);
            if (idx === 0 && depth > 0) {
                cell.style.paddingLeft = `${depth * 16 + 8}px`;
            }
            rowEl.appendChild(cell);
        });

        return rowEl;
    }

    private renderCell(row: ITableRow, col: ITableColumn): HTMLDivElement {
        const cell = document.createElement("div");
        cell.className = "skiba-table__cell";
        cell.style.width = `${this.columnWidth(col)}px`;
        cell.setAttribute("role", "cell");

        const rawValue = row.values[col.name];
        const text = document.createElement("span");
        text.className = "skiba-table__cell-text";
        text.textContent = rawValue === null || rawValue === undefined ? "" : String(rawValue);
        cell.appendChild(text);

        if (this.settings.conditionalFormatEnabled && col.isMeasure && typeof rawValue === "number") {
            const range = this._columnMinMax.get(col.name);
            if (range && range.max > range.min) {
                const t = (rawValue - range.min) / (range.max - range.min);
                cell.style.backgroundColor = d3.interpolateRgb(this.settings.conditionalFormatMinColor, this.settings.conditionalFormatMaxColor)(t);
            }
        }

        if (this.settings.enableDataBars && col.isMeasure && typeof rawValue === "number") {
            const maxAbs = this.columnStatsMax(col.name);
            if (maxAbs > 0) {
                const bar = document.createElement("div");
                bar.className = "skiba-table__data-bar";
                const widthPct = Math.min(100, (Math.abs(rawValue) / maxAbs) * 100);
                bar.style.width = `${widthPct}%`;
                cell.insertBefore(bar, text);
            }
        }

        return cell;
    }

    private columnStatsMax(columnName: string): number {
        if (this.columnMaxCache.has(columnName)) {
            return this.columnMaxCache.get(columnName)!;
        }
        let max = 0;
        this._data.forEach((r) => {
            const v = r.values[columnName];
            if (typeof v === "number") {
                max = Math.max(max, Math.abs(v));
            }
        });
        this.columnMaxCache.set(columnName, max);
        return max;
    }

    private renderTotalsRow(visibleColumns: ITableColumn[], rowHeight: number): HTMLDivElement {
        const rowEl = document.createElement("div");
        rowEl.className = "skiba-table__row skiba-table__row--totals";
        rowEl.style.height = `${rowHeight}px`;

        visibleColumns.forEach((col, idx) => {
            const cell = document.createElement("div");
            cell.className = "skiba-table__cell";
            cell.style.width = `${this.columnWidth(col)}px`;

            if (idx === 0) {
                cell.textContent = this.settings.totalsLabel;
            } else if (col.isMeasure) {
                const sum = d3.sum(this._filteredData, (r) => {
                    const v = r.values[col.name];
                    return typeof v === "number" ? v : 0;
                });
                cell.textContent = this.formatNumber(sum);
            }
            rowEl.appendChild(cell);
        });

        return rowEl;
    }

    private formatNumber(value: number): string {
        if (Number.isInteger(value)) {
            return value.toLocaleString();
        }
        return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    // -----------------------------------------------------------------
    // Smart tooltips (mean / deviation) — insight without extra UI
    // -----------------------------------------------------------------

    private computeColumnStats(): void {
        this._columnStats.clear();
        this._columnMinMax.clear();
        this.columnMaxCache.clear();
        this.valueColumns.forEach((col) => {
            const values = this._data
                .map((r) => r.values[col.name])
                .filter((v): v is number => typeof v === "number");
            if (values.length === 0) {
                return;
            }
            const mean = d3.mean(values) ?? 0;
            const deviation = d3.deviation(values) ?? 0;
            this._columnStats.set(col.name, { mean, deviation });
            this._columnMinMax.set(col.name, { min: d3.min(values) ?? 0, max: d3.max(values) ?? 0 });
        });
    }

    private showRowTooltip(row: ITableRow, evt: MouseEvent): void {
        const items: VisualTooltipDataItem[] = [];

        this.valueColumns.forEach((col) => {
            const raw = row.values[col.name];
            if (typeof raw !== "number") {
                return;
            }
            const stats = this._columnStats.get(col.name);
            let detail = this.formatNumber(raw);
            if (stats) {
                const variancePct = stats.mean !== 0 ? ((raw - stats.mean) / stats.mean) * 100 : 0;
                const sign = variancePct >= 0 ? "+" : "";
                detail += ` (avg ${this.formatNumber(stats.mean)}, ${sign}${variancePct.toFixed(1)}% vs avg, \u03C3 ${this.formatNumber(stats.deviation)})`;
            }
            items.push({ displayName: col.displayName, value: detail });
        });

        if (items.length === 0) {
            return;
        }

        this.tooltipService.show({
            coordinates: [evt.clientX, evt.clientY],
            isTouchEvent: false,
            dataItems: items,
            identities: [row.selectionId]
        });
    }

    private moveTooltip(evt: MouseEvent): void {
        this.tooltipService.move({
            coordinates: [evt.clientX, evt.clientY],
            isTouchEvent: false,
            dataItems: [],
            identities: []
        });
    }

    private hideTooltip(): void {
        this.tooltipService.hide({ immediately: true, isTouchEvent: false });
    }

    // -----------------------------------------------------------------
    // Export
    // -----------------------------------------------------------------

    private exportCSV(): void {
        const visibleColumns = this.visibleColumns();
        const header = visibleColumns.map((c) => c.displayName);
        const rows: string[][] = this._filteredData.map((row) =>
            visibleColumns.map((col) => {
                const v = row.values[col.name];
                return v === null || v === undefined ? "" : String(v);
            })
        );
        const csv = d3.csvFormatRows([header, ...rows]);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        this.downloadBlob(blob, "skiba-tables-export.csv");
    }

    /** Real .xlsx export via SheetJS — requires `npm install xlsx --save` in the project. */
    private exportExcel(): void {
        const visibleColumns = this.visibleColumns();
        const header = visibleColumns.map((c) => c.displayName);
        const aoa: (string | number)[][] = [header];

        this._filteredData.forEach((row) => {
            aoa.push(visibleColumns.map((col) => {
                const v = row.values[col.name];
                if (v === null || v === undefined) {
                    return "";
                }
                return typeof v === "number" ? v : String(v);
            }));
        });

        const worksheet = XLSX.utils.aoa_to_sheet(aoa);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
        const wbout: ArrayBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
        const blob = new Blob([wbout], { type: "application/octet-stream" });
        this.downloadBlob(blob, "skiba-tables-export.xlsx");
    }

    private exportPDF(): void {
        // Lightweight, dependency-free path: leverage the browser's native
        // print-to-PDF via a dedicated print stylesheet.
        const originalTitle = document.title;
        document.title = "Skiba Tables export";
        this.container.classList.add("skiba-print-mode");
        window.print();
        this.container.classList.remove("skiba-print-mode");
        document.title = originalTitle;
    }

    private downloadBlob(blob: Blob, filename: string): void {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    // -----------------------------------------------------------------
    // Empty state
    // -----------------------------------------------------------------

    /** Renders the calm SKIBA ANALYTICS placeholder instead of a blank box. */
    public renderEmptyState(): void {
        this.container.innerHTML = "";
        const wrap = document.createElement("div");
        wrap.className = "skiba-empty-state";

        const brand = document.createElement("div");
        brand.className = "skiba-empty-state__brand";
        brand.textContent = "SKIBA ANALYTICS";
        wrap.appendChild(brand);

        const tagline = document.createElement("div");
        tagline.className = "skiba-empty-state__tagline";
        tagline.textContent = "Next-Gen Analytical Tables";
        wrap.appendChild(tagline);

        const helper = document.createElement("div");
        helper.className = "skiba-empty-state__helper";
        helper.textContent = "Add fields to Rows and Values to get started";
        wrap.appendChild(helper);

        this.container.appendChild(wrap);
    }
}
