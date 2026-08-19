export type ExportKind = "csv" | "excel" | "pdf";
export type GovernmentCurrency = "UGX" | "USD" | "EUR" | "GBP" | "MWK";
export interface IExportGovernance { enabled: boolean; watermarkText: string; locale: string; currency: string; username: string; }
export interface IExportAuditEvent { kind: ExportKind; username: string; rowCount: number; timestamp: string; }

export function formatLocaleNumber(value: number, locale?: string, currency?: string): string {
    const options: Intl.NumberFormatOptions = currency ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : (Number.isInteger(value) ? { maximumFractionDigits: 0 } : { maximumFractionDigits: 2 });
    if (currency) { options.style = "currency"; options.currency = currency; }
    return new Intl.NumberFormat(locale || undefined, options).format(value);
}

export function buildWatermarkText(governance?: Partial<IExportGovernance>): string {
    if (!governance || governance.enabled !== true) { return ""; }
    return String(governance.watermarkText || "CONFIDENTIAL").slice(0, 160);
}

export function createExportAuditEvent(kind: ExportKind, username: string, rowCount: number, now = new Date()): IExportAuditEvent {
    return { kind, username: username || "unknown", rowCount: Math.max(0, Math.floor(rowCount)), timestamp: now.toISOString() };
}

export function recordExportAudit(event: IExportAuditEvent): void {
    if (typeof console !== "undefined" && typeof console.info === "function") { console.info("[Skiba Tables export audit]", JSON.stringify(event)); }
}
