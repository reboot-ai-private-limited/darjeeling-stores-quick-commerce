import { z } from "zod";
import type { Route } from "../../../platform/routes.js";
import { guarded, parse, sendData, type AuthResolver } from "../../catalog/catalog.public.js";
import type { ReportService } from "../application/report-service.js";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const dashboardQuery = z.object({ warehouseId: id.optional() }).strict();
const reportQuery = z.object({
  from: day.optional(), to: day.optional(), warehouseId: id.optional(), groupBy: z.enum(["day", "warehouse", "product", "category", "rider", "status", "coupon"]).optional(),
  format: z.enum(["json", "csv"]).default("json"),
}).strict();

/** The dashboard and report endpoints of F25. */
export function reportRoutes(service: ReportService, auth: AuthResolver): Route[] {
  const dashboard = (h: Parameters<typeof guarded>[2]) => guarded(auth, "dashboard:view", h);
  const reports = (h: Parameters<typeof guarded>[2]) => guarded(auth, "reports:view", h);
  return [
    { method: "get", path: "/admin/dashboard", handler: dashboard(async (ctx, req, res) => { res.setHeader("Cache-Control", "no-store"); sendData(res, await service.dashboard(ctx, parse(dashboardQuery, req.query))); }) },
    { method: "get", path: "/admin/reports", handler: reports((_ctx, _req, res) => sendData(res, service.list())) },
    { method: "get", path: "/admin/reports/:name", handler: reports(async (ctx, req, res) => {
      const { format, ...query } = parse(reportQuery, req.query);
      const result = await service.run(ctx, String(req.params.name), query);
      res.setHeader("Cache-Control", "no-store");
      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${result.name}-${result.from}-${result.to}.csv"`);
        res.status(200).send(service.csv(result));
        return;
      }
      sendData(res, result);
    }) },
  ];
}
