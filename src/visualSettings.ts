"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * General card: font family, font size, base row height.
 */
class GeneralSettingsCard extends FormattingSettingsCard {
    fontFamily = new formattingSettings.TextInput({
        name: "fontFamily",
        displayName: "Font family",
        placeholder: "Segoe UI, sans-serif",
        value: "Segoe UI, sans-serif"
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Font size",
        value: 12
    });

    rowHeight = new formattingSettings.NumUpDown({
        name: "rowHeight",
        displayName: "Row height",
        value: 32
    });

    name: string = "general";
    displayName: string = "General";
    slices: FormattingSettingsSlice[] = [this.fontFamily, this.fontSize, this.rowHeight];
}

/**
 * Header card: background, text color, bold.
 */
class HeaderSettingsCard extends FormattingSettingsCard {
    bgColor = new formattingSettings.ColorPicker({
        name: "bgColor",
        displayName: "Background color",
        value: { value: "#F0F2F5" }
    });

    fontColor = new formattingSettings.ColorPicker({
        name: "fontColor",
        displayName: "Font color",
        value: { value: "#333333" }
    });

    bold = new formattingSettings.ToggleSwitch({
        name: "bold",
        displayName: "Bold",
        value: true
    });

    name: string = "header";
    displayName: string = "Header";
    slices: FormattingSettingsSlice[] = [this.bgColor, this.fontColor, this.bold];
}

/**
 * Cells card: background, text color, alternate (zebra) row color.
 */
class CellsSettingsCard extends FormattingSettingsCard {
    bgColor = new formattingSettings.ColorPicker({
        name: "bgColor",
        displayName: "Background color",
        value: { value: "#FFFFFF" }
    });

    fontColor = new formattingSettings.ColorPicker({
        name: "fontColor",
        displayName: "Font color",
        value: { value: "#333333" }
    });

    alternateRowColor = new formattingSettings.ColorPicker({
        name: "alternateRowColor",
        displayName: "Alternate row color",
        value: { value: "#FAFAFA" }
    });

    name: string = "cells";
    displayName: string = "Cells";
    slices: FormattingSettingsSlice[] = [this.bgColor, this.fontColor, this.alternateRowColor];
}

/**
 * In-cell data bars card.
 */
class DataBarsSettingsCard extends FormattingSettingsCard {
    enableDataBars = new formattingSettings.ToggleSwitch({
        name: "enableDataBars",
        displayName: "Show data bars",
        value: false
    });

    barColor = new formattingSettings.ColorPicker({
        name: "barColor",
        displayName: "Bar color",
        value: { value: "#0078D4" }
    });

    name: string = "formatting";
    displayName: string = "Data bars";
    slices: FormattingSettingsSlice[] = [this.enableDataBars, this.barColor];
}

/**
 * Totals row card.
 */
class TotalsSettingsCard extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Show totals row",
        value: false
    });

    label = new formattingSettings.TextInput({
        name: "label",
        displayName: "Label",
        placeholder: "Total",
        value: "Total"
    });

    bgColor = new formattingSettings.ColorPicker({
        name: "bgColor",
        displayName: "Background color",
        value: { value: "#F0F2F5" }
    });

    name: string = "totals";
    displayName: string = "Totals";
    slices: FormattingSettingsSlice[] = [this.show, this.label, this.bgColor];
}

/**
 * Virtual scrolling card. On by default -- performance-as-default, never
 * something the user has to discover or configure to get a smooth table.
 */
class VirtualScrollingSettingsCard extends FormattingSettingsCard {
    enabled = new formattingSettings.ToggleSwitch({
        name: "enabled",
        displayName: "Enabled",
        value: true
    });

    rowHeight = new formattingSettings.NumUpDown({
        name: "rowHeight",
        displayName: "Row height",
        value: 35
    });

    name: string = "virtualScrolling";
    displayName: string = "Smooth scrolling";
    slices: FormattingSettingsSlice[] = [this.enabled, this.rowHeight];
}

/**
 * Toolbar visibility card.
 */
class ToolbarSettingsCard extends FormattingSettingsCard {
    showMenu = new formattingSettings.ToggleSwitch({
        name: "showMenu",
        displayName: "Show toolbar",
        value: true
    });

    name: string = "toolbar";
    displayName: string = "Toolbar";
    slices: FormattingSettingsSlice[] = [this.showMenu];
}

/**
 * Search visibility card.
 */
class SearchSettingsCard extends FormattingSettingsCard {
    enabled = new formattingSettings.ToggleSwitch({
        name: "enabled",
        displayName: "Enable search",
        value: true
    });

    name: string = "search";
    displayName: string = "Search";
    slices: FormattingSettingsSlice[] = [this.enabled];
}

/**
 * Grouping card: whether multi-level groups (from the "Group by" role)
 * start expanded or collapsed.
 */
class GroupingSettingsCard extends FormattingSettingsCard {
    defaultExpanded = new formattingSettings.ToggleSwitch({
        name: "defaultExpanded",
        displayName: "Expand groups by default",
        value: true
    });

    name: string = "grouping";
    displayName: string = "Grouping";
    slices: FormattingSettingsSlice[] = [this.defaultExpanded];
}

/**
 * Column filters card: toggles the small filter icon in each header cell
 * that opens a type-aware filter popover (text / number / date).
 */
class FiltersSettingsCard extends FormattingSettingsCard {
    showIcons = new formattingSettings.ToggleSwitch({
        name: "showIcons",
        displayName: "Show column filter icons",
        value: true
    });

    name: string = "filters";
    displayName: string = "Column filters";
    slices: FormattingSettingsSlice[] = [this.showIcons];
}

/**
 * Conditional formatting card: a two-color scale applied to measure cells
 * based on that column's min/max across the full (unfiltered) dataset.
 */
class ConditionalFormattingSettingsCard extends FormattingSettingsCard {
    enabled = new formattingSettings.ToggleSwitch({
        name: "enabled",
        displayName: "Enable color scale",
        value: false
    });

    minColor = new formattingSettings.ColorPicker({
        name: "minColor",
        displayName: "Low color",
        value: { value: "#FDE2E2" }
    });

    maxColor = new formattingSettings.ColorPicker({
        name: "maxColor",
        displayName: "High color",
        value: { value: "#2E7D32" }
    });

    name: string = "conditionalFormatting";
    displayName: string = "Conditional formatting";
    slices: FormattingSettingsSlice[] = [this.enabled, this.minColor, this.maxColor];
}

/**
 * Top level formatting settings model, aggregating every card above.
 * Consumed by FormattingSettingsService in visual.ts.
 */
export class VisualSettingsModel extends FormattingSettingsModel {
    general = new GeneralSettingsCard();
    header = new HeaderSettingsCard();
    cells = new CellsSettingsCard();
    formatting = new DataBarsSettingsCard();
    totals = new TotalsSettingsCard();
    virtualScrolling = new VirtualScrollingSettingsCard();
    toolbar = new ToolbarSettingsCard();
    search = new SearchSettingsCard();
    grouping = new GroupingSettingsCard();
    filters = new FiltersSettingsCard();
    conditionalFormatting = new ConditionalFormattingSettingsCard();

    cards: FormattingSettingsCard[] = [
        this.general,
        this.header,
        this.cells,
        this.formatting,
        this.totals,
        this.virtualScrolling,
        this.toolbar,
        this.search,
        this.grouping,
        this.filters,
        this.conditionalFormatting
    ];
}
