import type { Connection } from "mongoose";
import { denyAll, type AuthResolver } from "../catalog/catalog.public.js";
import { createReportService } from "./application/report-service.js";
import type { SettingsSource } from "./application/ports.js";
import { createMongoReportStore } from "./infrastructure/mongo-report-store.js";
import { reportRoutes } from "./interface/routes.js";

export type { ReportService, ReportQuery, ReportResult } from "./application/report-service.js";
export type { Dashboard, DashboardSettings, SettingsSource } from "./application/ports.js";
export type { ReportDef, ReportParams, ReportTable } from "./domain/reports.js";
export { addDays, dayRange, dayStart, istDay, toCsv } from "./domain/reports.js";

export interface ReportsModuleOptions {
  connection: Connection; auth?: AuthResolver;
  /** Reads the delayed-order and low-stock settings on each request. Defaults to the built-in values. */
  settings?: SettingsSource;
  /** Reports other modules add (for example delivery). */
  extraReports?: import("./domain/reports.js").ReportDef[];
}

/** The dashboard and the report registry (F25). Other modules may add reports through `service.register`. */
export function createReportsModule(options: ReportsModuleOptions) {
  const { dashboard, reports } = createMongoReportStore(options.connection);
  const service = createReportService({ dashboard, reports: [...reports, ...(options.extraReports ?? [])], ...(options.settings && { settings: options.settings }), now: () => new Date() });
  return { service, routes: reportRoutes(service, options.auth ?? denyAll) };
}
