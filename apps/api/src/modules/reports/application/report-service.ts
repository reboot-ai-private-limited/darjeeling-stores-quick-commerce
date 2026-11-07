import { assertWarehouseScope, notFound, validation, type Ctx } from "../../catalog/catalog.public.js";
import { dayRange, dayStart, istDay, toCsv, type ReportDef, type ReportParams, type ReportTable } from "../domain/reports.js";
import { DEFAULT_DASHBOARD_SETTINGS, type Dashboard, type DashboardStore, type SettingsSource } from "./ports.js";

export interface ReportQuery { from?: string | undefined; to?: string | undefined; warehouseId?: string | undefined; groupBy?: string | undefined }
export interface ReportResult extends ReportTable { name: string; from: string; to: string; groupBy: string }

export interface ReportDeps {
  dashboard: DashboardStore; reports: readonly ReportDef[]; settings?: SettingsSource; now: () => Date;
}

export function createReportService({ dashboard, reports, settings, now }: ReportDeps) {
  const registry = new Map(reports.map(r => [r.name, r] as const));
  /** Another module (for example delivery) adds its own report; names are unique. */
  function register(def: ReportDef): void {
    if (registry.has(def.name)) throw new Error(`Duplicate report: ${def.name}`);
    registry.set(def.name, def);
  }
  /** The warehouses a request may look at: the one asked for (if allowed), else every permitted one. `null` means all. */
  function warehousesFor(ctx: Ctx, warehouseId: string | undefined): readonly string[] | null {
    if (warehouseId) { assertWarehouseScope(ctx.actor, warehouseId); return [warehouseId]; }
    return ctx.actor.scope.all ? null : ctx.actor.scope.warehouseIds;
  }

  return {
    register,

    async dashboard(ctx: Ctx, query: { warehouseId?: string | undefined }): Promise<Dashboard> {
      const at = now();
      const date = istDay(at);
      const warehouseIds = warehousesFor(ctx, query.warehouseId);
      const values = await (settings?.(query.warehouseId) ?? Promise.resolve(DEFAULT_DASHBOARD_SETTINGS));
      return dashboard.dashboard({
        date, start: dayStart(date), end: new Date(dayStart(date).getTime() + 86_400_000), now: at, warehouseIds,
        delayedAfterMinutes: values.delayedAfterMinutes, lowStock: { grams: values.lowStockGrams, units: values.lowStockUnits },
      });
    },

    list() {
      return [...registry.values()].map(r => ({ name: r.name, title: r.title, groupBy: r.groupBy, defaultGroupBy: r.defaultGroupBy }));
    },

    async run(ctx: Ctx, name: string, query: ReportQuery): Promise<ReportResult> {
      const def = registry.get(name);
      if (!def) throw notFound("Report");
      const range = dayRange(query, now());
      if ("error" in range) throw validation(range.error, [{ path: "from", message: range.error }]);
      const groupBy = query.groupBy ?? def.defaultGroupBy;
      if (!def.groupBy.includes(groupBy)) throw validation("This report cannot be grouped that way", [{ path: "groupBy", message: `Use one of: ${def.groupBy.join(", ")}` }]);
      const params: ReportParams = { range, warehouseIds: warehousesFor(ctx, query.warehouseId), groupBy };
      const table = await def.run(params);
      return { name, from: range.from, to: range.to, groupBy, ...table };
    },

    csv(result: ReportResult): string { return toCsv(result); },
  };
}

export type ReportService = ReturnType<typeof createReportService>;
