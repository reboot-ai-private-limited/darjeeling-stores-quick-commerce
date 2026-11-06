import type { Route } from "../../../platform/routes.js";
import { guarded, parse, pathId, sendData, type AuthResolver } from "../../catalog/catalog.public.js";
import type { OfferingsService } from "../application/offerings-service.js";
import type { ImportService } from "../application/import-service.js";
import type { TreeService } from "../application/tree-service.js";
import { adjustBody, bulkBody, commitBody, countBody, createBody, historyQuery, levelsQuery, listQuery, movementsQuery, previewBody, treeQuery, updateBody } from "./schemas.js";

/** The 10 endpoints of docs/api/F05-warehouse-stock-and-pricing.md and the 3 of F06-product-import-and-admin-tree.md. Paths are relative to the API prefix. */
export function offeringsRoutes(service: OfferingsService, auth: AuthResolver, tools: { tree: TreeService; importer: ImportService }): Route[] {
  const route = (permission: string, h: Parameters<typeof guarded>[2]) => guarded(auth, permission, h);
  return [
    { method: "get", path: "/admin/warehouses/:id/products", handler: route("warehouse_catalog:view", async (ctx, req, res) => {
      const page = await service.listForWarehouse(ctx, pathId(req, "id", "Warehouse"), parse(listQuery, req.query));
      sendData(res, page.items, 200, { nextCursor: page.nextCursor });
    }) },
    { method: "post", path: "/admin/warehouse-products", handler: route("warehouse_catalog:manage", async (ctx, req, res) =>
      sendData(res, await service.create(ctx, parse(createBody, req.body)), 201)) },
    { method: "get", path: "/admin/warehouses/:id/tree", handler: route("warehouse_catalog:view", async (ctx, req, res) =>
      sendData(res, await tools.tree.tree(ctx, pathId(req, "id", "Warehouse"), parse(treeQuery, req.query)))) },
    { method: "post", path: "/admin/import/preview", handler: route("catalog:import", async (ctx, req, res) =>
      sendData(res, await tools.importer.preview(ctx, parse(previewBody, req.body)))) },
    { method: "post", path: "/admin/import/commit", handler: route("catalog:import", async (ctx, req, res) =>
      sendData(res, await tools.importer.commit(ctx, parse(commitBody, req.body)), 201)) },
    // Fixed path before the /:id routes.
    { method: "post", path: "/admin/warehouse-products/bulk", handler: route("warehouse_catalog:manage", async (ctx, req, res) =>
      sendData(res, await service.bulk(ctx, parse(bulkBody, req.body)))) },
    { method: "get", path: "/admin/warehouse-products/:id", handler: route("warehouse_catalog:view", async (ctx, req, res) =>
      sendData(res, await service.get(ctx, pathId(req, "id", "Offering")))) },
    { method: "put", path: "/admin/warehouse-products/:id", handler: route("warehouse_catalog:manage", async (ctx, req, res) =>
      sendData(res, await service.update(ctx, pathId(req, "id", "Offering"), parse(updateBody, req.body)))) },
    { method: "post", path: "/admin/stock/adjust", handler: route("stock:manage", async (ctx, req, res) =>
      sendData(res, await service.adjust(ctx, parse(adjustBody, req.body)))) },
    { method: "post", path: "/admin/stock/count", handler: route("stock:manage", async (ctx, req, res) =>
      sendData(res, await service.count(ctx, parse(countBody, req.body)))) },
    { method: "get", path: "/admin/stock/levels", handler: route("stock:view", async (ctx, req, res) => {
      const page = await service.levels(ctx, parse(levelsQuery, req.query));
      sendData(res, page.items, 200, { nextCursor: page.nextCursor });
    }) },
    { method: "get", path: "/admin/stock/movements", handler: route("stock:view", async (ctx, req, res) => {
      const page = await service.movements(ctx, parse(movementsQuery, req.query));
      sendData(res, page.items, 200, { nextCursor: page.nextCursor });
    }) },
    { method: "get", path: "/admin/price-history", handler: route("stock:view", async (ctx, req, res) => {
      const page = await service.priceHistory(ctx, parse(historyQuery, req.query));
      sendData(res, page.items, 200, { nextCursor: page.nextCursor });
    }) },
  ];
}
