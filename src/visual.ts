"use strict";

import "../style/visual.less";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";

import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import DataView = powerbi.DataView;
import DataViewTable = powerbi.DataViewTable;
import DataViewTableRow = powerbi.DataViewTableRow;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import ITooltipService = powerbi.extensibility.ITooltipService;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ILocalizationManager = powerbi.extensibility.ILocalizationManager;
import ISandboxExtendedColorPalette = powerbi.extensibility.ISandboxExtendedColorPalette;

import { VisualSettingsModel } from "./visualSettings";
import {
    TableRenderer,
    ITableColumn,
    ITableRow,
    ITableRendererSettings,
    ISavedViewState,
    ILinkActionRule,
    LinkActionOperator
} from "./tableRenderer";

export class SkibaTables implements IVisual {
    private host: IVisualHost;
    private selectionManager: ISelectionManager;
    private tooltipService: ITooltipService;
    private events: IVisualEventService;
    private localizationManager: ILocalizationManager;
    private colorPalette: ISandboxExtendedColorPalette;

    private formattingSettingsService: FormattingSettingsService;
    private settingsModel: VisualSettingsModel = new VisualSettingsModel();

    private rootElement: HTMLElement;
    private tableContainer: HTMLDivElement;
    private tableRenderer: TableRenderer;

    /** Item 7: guards against re-applying the saved default view on every update() -- it should only happen once, when the report is freshly opened. */
    private hasAppliedSavedView = false;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.selectionManager = this.host.createSelectionManager();
        this.tooltipService = this.host.tooltipService;
        this.events = this.host.eventService;
        this.localizationManager = this.host.createLocalizationManager();
        this.colorPalette = this.host.colorPalette;
        // Passing the localization manager lets the formatting-model service resolve
        // each card/slice's `displayNameKey` against stringResources automatically,
        // so the format pane itself is localized, not just the on-canvas UI.
        this.formattingSettingsService = new FormattingSettingsService(this.localizationManager);

        this.rootElement = options.element;
        this.rootElement.classList.add("skiba-tables-visual");

        this.tableContainer = document.createElement("div");
        this.tableContainer.className = "skiba-tables-container";
        this.rootElement.appendChild(this.tableContainer);

        this.tableRenderer = new TableRenderer(
            this.tableContainer,
            this.host,
            this.selectionManager,
            this.tooltipService,
            this.localizationManager,
            this.colorPalette
        );

        // Clicking empty space (outside a row) clears the cross-filter selection,
        // matching the standard Power BI interaction users already know. This is a
        // selection interaction, so it must respect allowInteractions (item 10) --
        // a read-only/embedded host shouldn't have its selection state mutated by a
        // stray click either.
        this.rootElement.addEventListener("click", (evt: MouseEvent) => {
            if (!this.allowInteractions()) {
                return;
            }
            const target = evt.target as HTMLElement;
            if (!target.closest(".skiba-table__row")) {
                this.selectionManager.clear().then(() => this.tableRenderer.syncExternalSelection());
            }
        });

        // Multi-visual selection sync (item 18): when the selection state changes from
        // Power BI's side -- another visual on the page cross-filters, a bookmark is
        // applied, the filter pane changes -- re-render so this visual's own highlighted
        // rows stay in sync without waiting for a full update() cycle.
        if (this.selectionManager.registerOnSelectCallback) {
            this.selectionManager.registerOnSelectCallback(() => {
                this.tableRenderer.syncExternalSelection();
            });
        }
    }

    public update(options: VisualUpdateOptions): void {
        // Rendering status reporting (item 17): must be the first line of update(), and
        // exactly one of renderingFinished/renderingFailed must be called before it exits.
        this.events.renderingStarted(options);

        try {
            this.updateInternal(options);
            this.events.renderingFinished(options);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.events.renderingFailed(options, reason);
            throw error;
        }
    }

    private updateInternal(options: VisualUpdateOptions): void {
        const dataViews = options.dataViews;
        const dataView: DataView | undefined = dataViews && dataViews[0];

        this.resizeViewport(options.viewport.width, options.viewport.height);

        this.settingsModel = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualSettingsModel,
            dataView
        );

        // Landing page (item 15): shown only in the authoring experience, and only before
        // any fields have ever been assigned to the visual -- i.e. there's no field metadata
        // at all yet. This is distinct from "fields are assigned but the current filter
        // context returns zero rows", which keeps the existing branded empty state below.
        // `supportsEmptyDataView` means Power BI still calls update() with a (mostly empty)
        // dataView in this state, so metadata.columns.length is the reliable signal here,
        // matching Microsoft's own landing-page reference pattern.
        const hasAnyFieldsAssigned = !!(dataView && dataView.metadata && dataView.metadata.columns && dataView.metadata.columns.length > 0);

        if (!hasAnyFieldsAssigned) {
            this.tableRenderer.renderLandingPage();
            return;
        }

        const table: DataViewTable | undefined = dataView && dataView.table;

        if (!table || !table.rows || table.rows.length === 0 || !table.columns || table.columns.length === 0) {
            this.tableRenderer.renderEmptyState();
            return;
        }

        const { rowColumns, groupColumns, valueColumns, tooltipColumns, columnIndex, permissionsColumnIndex } = this.parseColumns(table.columns);

        if (rowColumns.length === 0 && groupColumns.length === 0 && valueColumns.length === 0) {
            this.tableRenderer.renderEmptyState();
            return;
        }

        const rows = this.parseRows(table, columnIndex);

        // Item 1/4 (tier1): calculated/combined columns are persisted under the
        // separate "userConfig" object so they survive a reload.
        const persistedState = dataView?.metadata?.objects?.["userConfig"]?.["state"] as string | undefined;

        const permission = this.resolvePermission(table, permissionsColumnIndex);
        const savedViewState = this.parseSavedViewState(dataView);
        const linkActionRules = this.parseAndValidateLinkActionRules(this.settingsModel.linkActions.rules.value);

        // Item 9: never let a malformed rules value crash the render -- just disable
        // the feature (empty rules) and surface one plain-language note in the pane.
        const rulesTextIsPresent = (this.settingsModel.linkActions.rules.value || "").trim().length > 0;
        this.settingsModel.linkActions.validationMessage.visible = rulesTextIsPresent && linkActionRules === null;

        const rendererSettings = this.buildRendererSettings(dataView as DataView, permission, savedViewState, linkActionRules ?? []);

        this.tableRenderer.setData(rowColumns, groupColumns, valueColumns, tooltipColumns, rows, rendererSettings, persistedState, "Skiba Tables");

        // Item 7: restore the report's saved default view exactly once, on the
        // first update() after this visual is constructed -- never on subsequent
        // updates (page filters, resizes, etc.), so it doesn't clobber the
        // viewer's in-session customizations.
        if (!this.hasAppliedSavedView) {
            this.tableRenderer.applyPersistedSavedViewIfPresent();
            this.hasAppliedSavedView = true;
        }
    }

    /**
     * Allow Interactions compliance (item 10): some hosts (e.g. a report exported to /
     * embedded in a read-only context, or a dashboard tile) hint that the visual should not
     * be interactive. Guarded centrally here and passed down to the renderer so every call
     * site -- row selection, context menu, clear-on-empty-click -- stays consistent without
     * duplicating the host-capability lookup.
     */
    private allowInteractions(): boolean {
        const hostCapabilities = this.host.hostCapabilities;
        return hostCapabilities ? hostCapabilities.allowInteractions !== false : true;
    }

    /**
     * Splits the flat metadata column list into four buckets:
     * - rowColumns: plain "Rows" role dimensions, displayed as normal columns
     * - groupColumns: "Group by" role dimensions, used to build nested,
     *   collapsible groups instead of being displayed as flat columns
     * - valueColumns: "Values" role measures
     * - tooltipColumns: "Tooltips" role fields -- excluded from the visible grid, but
     *   still tracked so the smart-tooltip renderer can surface them on hover (item 19)
     */
    private parseColumns(columns: DataViewMetadataColumn[]): {
        rowColumns: ITableColumn[];
        groupColumns: ITableColumn[];
        valueColumns: ITableColumn[];
        tooltipColumns: ITableColumn[];
        columnIndex: DataViewMetadataColumn[];
        permissionsColumnIndex: number | null;
    } {
        const rowColumns: ITableColumn[] = [];
        const groupColumns: ITableColumn[] = [];
        const valueColumns: ITableColumn[] = [];
        const tooltipColumns: ITableColumn[] = [];
        let permissionsColumnIndex: number | null = null;

        columns.forEach((col, index) => {
            const roles = col.roles || {};

            // Item 8: the optional "Permissions" role carries a resolved per-viewer
            // access string (from a DAX measure), not a displayable column -- track
            // its index so parseRows() can read the raw value, but never bucket it
            // into rows/groupBy/values like the other roles below.
            if (roles["permissions"]) {
                permissionsColumnIndex = index;
                return;
            }

            const tableColumn: ITableColumn = {
                name: col.displayName,
                displayName: col.displayName,
                isMeasure: !!roles["values"],
                isGroupBy: !!roles["groupBy"]
            };

            if (roles["groupBy"]) {
                groupColumns.push(tableColumn);
            } else if (roles["rows"]) {
                rowColumns.push(tableColumn);
            } else if (roles["values"]) {
                valueColumns.push(tableColumn);
            }

            // Tooltip-role fields are excluded from the visible grid (per the data
            // contract) but tracked separately so they can still appear on hover.
            if (roles["tooltips"]) {
                tooltipColumns.push(tableColumn);
            }
        });

        return { rowColumns, groupColumns, valueColumns, tooltipColumns, columnIndex: columns, permissionsColumnIndex };
    }

    /**
     * Item 8: resolves the current viewer's permission string from the bound
     * "Permissions" DAX measure. The measure is evaluated per row context but, in
     * practice, depends only on USERPRINCIPALNAME()/USERNAME() (looked up against
     * a permissions table the report author maintains), so it is identical across
     * every row for a given viewer -- reading the first row is sufficient. Returns
     * null when the role is left unbound entirely, in which case every caller of
     * this value must treat null as "full functionality, no restriction."
     */
    private resolvePermission(table: DataViewTable, permissionsColumnIndex: number | null): string | null {
        if (permissionsColumnIndex === null || !table.rows || table.rows.length === 0) {
            return null;
        }
        const raw = table.rows[0][permissionsColumnIndex];
        return raw === null || raw === undefined ? null : String(raw);
    }

    /** Item 7: reads back the persisted "report's default view" from the report's own object model, if one has been saved. */
    private parseSavedViewState(dataView: DataView | undefined): ISavedViewState | null {
        const objects = dataView && dataView.metadata && dataView.metadata.objects;
        const raw = objects && objects["savedView"] && (objects["savedView"] as { [k: string]: unknown })["state"];
        if (typeof raw !== "string" || raw.trim().length === 0) {
            return null;
        }
        try {
            return JSON.parse(raw) as ISavedViewState;
        } catch {
            return null;
        }
    }

    /**
     * Item 9: parses and validates the `linkActions.rules` JSON array. Returns
     * null (never throws) on anything malformed, so the caller can quietly
     * disable the feature and flag the one validation message in the pane, per
     * the mandatory safety constraints. Returns an empty array for an
     * intentionally-empty field (not an error).
     */
    private parseAndValidateLinkActionRules(raw: string): ILinkActionRule[] | null {
        const text = (raw || "").trim();
        if (text.length === 0) {
            return [];
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            return null;
        }

        if (!Array.isArray(parsed)) {
            return null;
        }

        const allowedOperators: LinkActionOperator[] = ["equals", "notEquals", "gt", "gte", "lt", "lte", "contains"];
        const rules: ILinkActionRule[] = [];

        for (const item of parsed) {
            if (!item || typeof item !== "object") {
                return null;
            }
            const candidate = item as { column?: unknown; operator?: unknown; value?: unknown; urlTemplate?: unknown };
            const { column, operator, value, urlTemplate } = candidate;

            if (typeof column !== "string" || column.length === 0) {
                return null;
            }
            if (typeof operator !== "string" || allowedOperators.indexOf(operator as LinkActionOperator) === -1) {
                return null;
            }
            if (typeof urlTemplate !== "string" || urlTemplate.length === 0) {
                return null;
            }
            if (typeof value !== "string" && typeof value !== "number") {
                return null;
            }

            rules.push({
                column,
                operator: operator as LinkActionOperator,
                value: String(value),
                urlTemplate
            });
        }

        return rules;
    }

    /** Flattens raw DataViewTable rows into renderer-friendly ITableRow objects with selection IDs. */
    private parseRows(table: DataViewTable, columns: DataViewMetadataColumn[]): ITableRow[] {
        const rawRows: DataViewTableRow[] = table.rows ?? [];
        return rawRows.map((rawRow: DataViewTableRow, rowIndex: number) => {
            const values: { [columnName: string]: powerbi.PrimitiveValue } = {};
            columns.forEach((col, colIndex) => {
                // Every column's value is kept, including Tooltip-role fields. They're
                // simply never added to the flat/group column lists in parseColumns, so
                // they never render as a visible cell -- but the smart-tooltip renderer
                // still needs their values, so they must not be dropped here (item 19).
                values[col.displayName] = rawRow[colIndex];
            });

            const selectionId: ISelectionId = this.host
                .createSelectionIdBuilder()
                .withTable(table, rowIndex)
                .createSelectionId();

            return {
                key: `row-${rowIndex}`,
                values,
                selectionId
            } as ITableRow;
        });
    }

    /**
     * Resolves a color for a formatting-pane slice: `dataView.metadata.objects` only ever
     * contains properties the user has *explicitly* set via the format pane (it's absent
     * entirely when every slice is still at its hardcoded default). So if this property is
     * present there, the user's own choice wins; otherwise the report's official color theme
     * takes over (item 11) instead of a hardcoded hex default.
     */
    private themeOrUserColor(
        dataView: DataView,
        objectName: string,
        propertyName: string,
        userValue: string,
        themeColor: string
    ): string {
        const objects = dataView.metadata && dataView.metadata.objects;
        const objectGroup = objects && (objects[objectName] as { [k: string]: unknown } | undefined);
        const isExplicitlySet = !!objectGroup && objectGroup[propertyName] !== undefined && objectGroup[propertyName] !== null;
        return isExplicitlySet ? userValue : themeColor;
    }

    /** Maps the formatting settings model (plus this update's resolved permission/saved-view/link-action state and theme) into the plain settings bag the renderer consumes. */
    private buildRendererSettings(
        dataView: DataView,
        permission: string | null,
        savedViewState: ISavedViewState | null,
        linkActionRules: ILinkActionRule[]
    ): ITableRendererSettings {
        const s = this.settingsModel;
        const palette = this.colorPalette;

        // Official Color Theme Integration (item 11): pull sensible theme-derived defaults
        // instead of the hardcoded #F0F2F5 / #0078D4 / etc, so the visual's header, cell,
        // and accent colors adapt to the report's theme. `getColor` cycles through the
        // report's data-color series -- used here as a deterministic accent color -- while
        // neutral background/foreground shades come from the extended palette.
        const themeHeaderBg = palette.backgroundLight ? palette.backgroundLight.value : "#F0F2F5";
        const themeHeaderFont = palette.foreground ? palette.foreground.value : "#333333";
        const themeCellBg = palette.background ? palette.background.value : "#FFFFFF";
        const themeCellFont = palette.foreground ? palette.foreground.value : "#333333";
        const themeAltRow = palette.backgroundLight ? palette.backgroundLight.value : "#FAFAFA";
        const themeAccent = (palette.getColor("skiba-tables-accent").value) || "#0078D4";
        const themeTotalsBg = palette.backgroundLight ? palette.backgroundLight.value : "#F0F2F5";

        const headerBg = this.themeOrUserColor(dataView, "header", "bgColor", s.header.bgColor.value.value, themeHeaderBg);
        const headerFont = this.themeOrUserColor(dataView, "header", "fontColor", s.header.fontColor.value.value, themeHeaderFont);
        const cellBg = this.themeOrUserColor(dataView, "cells", "bgColor", s.cells.bgColor.value.value, themeCellBg);
        const cellFont = this.themeOrUserColor(dataView, "cells", "fontColor", s.cells.fontColor.value.value, themeCellFont);
        const altRow = this.themeOrUserColor(dataView, "cells", "alternateRowColor", s.cells.alternateRowColor.value.value, themeAltRow);
        const barColor = this.themeOrUserColor(dataView, "formatting", "barColor", s.formatting.barColor.value.value, themeAccent);
        const totalsBg = this.themeOrUserColor(dataView, "totals", "bgColor", s.totals.bgColor.value.value, themeTotalsBg);

        return {
            fontFamily: s.general.fontFamily.value,
            fontSize: s.general.fontSize.value,
            rowHeight: s.general.rowHeight.value,
            headerBg,
            headerFont,
            headerBold: s.header.bold.value,
            cellBg,
            cellFont,
            altRow,
            enableDataBars: s.formatting.enableDataBars.value,
            barColor,
            showTotals: s.totals.show.value,
            totalsLabel: s.totals.label.value,
            totalsBg,
            virtualScrollEnabled: s.virtualScrolling.enabled.value,
            virtualScrollRowHeight: s.virtualScrolling.rowHeight.value,
            showToolbar: s.toolbar.showMenu.value,
            searchEnabled: s.search.enabled.value,
            enableColumnFilters: s.filters.showIcons.value,
            conditionalFormatEnabled: s.conditionalFormatting.enabled.value,
            conditionalFormatMinColor: s.conditionalFormatting.minColor.value.value,
            conditionalFormatMaxColor: s.conditionalFormatting.maxColor.value.value,
            groupsDefaultExpanded: s.grouping.defaultExpanded.value,
            permission,
            linkActionRules,
            linkActionIconColumn: s.linkActions.iconColumn.value,
            savedViewState,
            allowInteractions: this.allowInteractions()
        };
    }

    private resizeViewport(width: number, height: number): void {
        this.tableContainer.style.width = `${width}px`;
        this.tableContainer.style.height = `${height}px`;
    }

    /** Required by IVisual: surfaces the formatting model to the Power BI formatting pane. */
    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.settingsModel);
    }
}
