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
import ITooltipService = powerbi.extensibility.ITooltipService;

import { VisualSettingsModel } from "./visualSettings";
import { TableRenderer, ITableColumn, ITableRow, ITableRendererSettings } from "./tableRenderer";

export class SkibaTables implements IVisual {
    private host: IVisualHost;
    private selectionManager: ISelectionManager;
    private tooltipService: ITooltipService;

    private formattingSettingsService: FormattingSettingsService;
    private settingsModel: VisualSettingsModel = new VisualSettingsModel();

    private rootElement: HTMLElement;
    private tableContainer: HTMLDivElement;
    private tableRenderer: TableRenderer;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.selectionManager = this.host.createSelectionManager();
        this.tooltipService = this.host.tooltipService;
        this.formattingSettingsService = new FormattingSettingsService();

        this.rootElement = options.element;
        this.rootElement.classList.add("skiba-tables-visual");

        this.tableContainer = document.createElement("div");
        this.tableContainer.className = "skiba-tables-container";
        this.rootElement.appendChild(this.tableContainer);

        this.tableRenderer = new TableRenderer(
            this.tableContainer,
            this.host,
            this.selectionManager,
            this.tooltipService
        );

        // Clicking empty space (outside a row) clears the cross-filter selection,
        // matching the standard Power BI interaction users already know.
        this.rootElement.addEventListener("click", (evt: MouseEvent) => {
            const target = evt.target as HTMLElement;
            if (!target.closest(".skiba-table__row")) {
                this.selectionManager.clear();
            }
        });
    }

    public update(options: VisualUpdateOptions): void {
        const dataViews = options.dataViews;

        this.settingsModel = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualSettingsModel,
            dataViews && dataViews[0]
        );

        const dataView: DataView | undefined = dataViews && dataViews[0];
        const table: DataViewTable | undefined = dataView && dataView.table;

        if (!table || !table.rows || table.rows.length === 0 || !table.columns || table.columns.length === 0) {
            this.tableRenderer.renderEmptyState();
            return;
        }

        const { rowColumns, groupColumns, valueColumns, columnIndex } = this.parseColumns(table.columns);

        if (rowColumns.length === 0 && groupColumns.length === 0 && valueColumns.length === 0) {
            this.tableRenderer.renderEmptyState();
            return;
        }

        const rows = this.parseRows(table, columnIndex);
        const rendererSettings = this.buildRendererSettings();

        this.resizeViewport(options.viewport.width, options.viewport.height);
        this.tableRenderer.setData(rowColumns, groupColumns, valueColumns, rows, rendererSettings);
    }

    /**
     * Splits the flat metadata column list into three buckets:
     * - rowColumns: plain "Rows" role dimensions, displayed as normal columns
     * - groupColumns: "Group by" role dimensions, used to build nested,
     *   collapsible groups instead of being displayed as flat columns
     * - valueColumns: "Values" role measures
     */
    private parseColumns(columns: DataViewMetadataColumn[]): {
        rowColumns: ITableColumn[];
        groupColumns: ITableColumn[];
        valueColumns: ITableColumn[];
        columnIndex: DataViewMetadataColumn[];
    } {
        const rowColumns: ITableColumn[] = [];
        const groupColumns: ITableColumn[] = [];
        const valueColumns: ITableColumn[] = [];

        columns.forEach((col) => {
            const roles = col.roles || {};
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
            // Columns with only the "tooltips" role are intentionally excluded
            // from the visible grid — they're hover-only, per the data contract.
        });

        return { rowColumns, groupColumns, valueColumns, columnIndex: columns };
    }

    /** Flattens raw DataViewTable rows into renderer-friendly ITableRow objects with selection IDs. */
    private parseRows(table: DataViewTable, columns: DataViewMetadataColumn[]): ITableRow[] {
        const rawRows: DataViewTableRow[] = table.rows ?? [];
        return rawRows.map((rawRow: DataViewTableRow, rowIndex: number) => {
            const values: { [columnName: string]: powerbi.PrimitiveValue } = {};
            columns.forEach((col, colIndex) => {
                const roles = col.roles || {};
                if (roles["tooltips"]) {
                    return;
                }
                values[col.displayName] = rawRow[colIndex];
            });

            const selectionId = this.host
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

    /** Maps the formatting settings model into the plain settings bag the renderer consumes. */
    private buildRendererSettings(): ITableRendererSettings {
        const s = this.settingsModel;
        return {
            fontFamily: s.general.fontFamily.value,
            fontSize: s.general.fontSize.value,
            rowHeight: s.general.rowHeight.value,
            headerBg: s.header.bgColor.value.value,
            headerFont: s.header.fontColor.value.value,
            headerBold: s.header.bold.value,
            cellBg: s.cells.bgColor.value.value,
            cellFont: s.cells.fontColor.value.value,
            altRow: s.cells.alternateRowColor.value.value,
            enableDataBars: s.formatting.enableDataBars.value,
            barColor: s.formatting.barColor.value.value,
            showTotals: s.totals.show.value,
            totalsLabel: s.totals.label.value,
            totalsBg: s.totals.bgColor.value.value,
            virtualScrollEnabled: s.virtualScrolling.enabled.value,
            virtualScrollRowHeight: s.virtualScrolling.rowHeight.value,
            showToolbar: s.toolbar.showMenu.value,
            searchEnabled: s.search.enabled.value,
            enableColumnFilters: s.filters.showIcons.value,
            conditionalFormatEnabled: s.conditionalFormatting.enabled.value,
            conditionalFormatMinColor: s.conditionalFormatting.minColor.value.value,
            conditionalFormatMaxColor: s.conditionalFormatting.maxColor.value.value,
            groupsDefaultExpanded: s.grouping.defaultExpanded.value
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
