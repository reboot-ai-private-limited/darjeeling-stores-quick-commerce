import type { Route } from "../../../platform/routes.js";
import type { CatalogService } from "../application/catalog-service.js";
import { guarded, parse, pathId, sendData, type AuthResolver } from "./http-support.js";
import {
  brandCreate, brandUpdate, categoryCreate, categoryUpdate, duplicateCheck, imageAttach, imageOrder, productCreate, productListQuery,
  productUpdate, reorderBody, variantCreate, variantUpdate,
} from "./schemas.js";

/** The endpoints of docs/api/F04-master-catalog.md (categories, products, variants, images, brands and the export). Paths are relative to the API prefix. */
export function catalogRoutes(service: CatalogService, auth: AuthResolver): Route[] {
  const view = (permission: string, h: Parameters<typeof guarded>[2]) => guarded(auth, permission, h);
  const ok = { ok: true };
  return [
    // categories
    { method: "get", path: "/admin/categories", handler: view("catalog:view", async (_c, _q, res) => sendData(res, await service.categoryTree())) },
    { method: "post", path: "/admin/categories", handler: view("catalog:manage", async (_c, req, res) => sendData(res, await service.createCategory(parse(categoryCreate, req.body)), 201)) },
    { method: "post", path: "/admin/categories/reorder", handler: view("catalog:manage", async (_c, req, res) => {
      const body = parse(reorderBody, req.body);
      await service.reorderCategories(body.parentId, body.orderedIds);
      sendData(res, ok);
    }) },
    { method: "put", path: "/admin/categories/:id", handler: view("catalog:manage", async (_c, req, res) => sendData(res, await service.updateCategory(pathId(req, "id", "Category"), parse(categoryUpdate, req.body)))) },
    { method: "delete", path: "/admin/categories/:id", handler: view("catalog:manage", async (ctx, req, res) => {
      await service.deleteCategory(ctx, pathId(req, "id", "Category"));
      sendData(res, ok);
    }) },

    // brands
    { method: "get", path: "/admin/brands", handler: view("catalog:view", async (_c, _q, res) => sendData(res, await service.listBrands())) },
    { method: "post", path: "/admin/brands", handler: view("catalog:manage", async (_c, req, res) => sendData(res, await service.createBrand(parse(brandCreate, req.body)), 201)) },
    { method: "put", path: "/admin/brands/:id", handler: view("catalog:manage", async (_c, req, res) => sendData(res, await service.updateBrand(pathId(req, "id", "Brand"), parse(brandUpdate, req.body)))) },
    { method: "delete", path: "/admin/brands/:id", handler: view("catalog:manage", async (ctx, req, res) => {
      await service.deleteBrand(ctx, pathId(req, "id", "Brand"));
      sendData(res, ok);
    }) },

    // products
    { method: "get", path: "/admin/products", handler: view("catalog:view", async (_c, req, res) => {
      const page = await service.listProducts(parse(productListQuery, req.query));
      sendData(res, page.items, 200, { nextCursor: page.nextCursor });
    }) },
    { method: "post", path: "/admin/products", handler: view("catalog:manage", async (_c, req, res) => sendData(res, await service.createProduct(parse(productCreate, req.body)), 201)) },
    // Fixed paths must be registered before the /:id routes below.
    { method: "post", path: "/admin/products/check-duplicate", handler: view("catalog:view", async (_c, req, res) => sendData(res, await service.checkDuplicate(parse(duplicateCheck, req.body)))) },
    { method: "get", path: "/admin/products/:id", handler: view("catalog:view", async (_c, req, res) => sendData(res, await service.getProduct(pathId(req, "id", "Product")))) },
    { method: "put", path: "/admin/products/:id", handler: view("catalog:manage", async (_c, req, res) => sendData(res, await service.updateProduct(pathId(req, "id", "Product"), parse(productUpdate, req.body)))) },
    { method: "post", path: "/admin/products/:id/archive", handler: view("catalog:manage", async (ctx, req, res) => sendData(res, await service.archiveProduct(ctx, pathId(req, "id", "Product")))) },
    { method: "post", path: "/admin/products/:id/restore", handler: view("catalog:manage", async (_c, req, res) => sendData(res, await service.restoreProduct(pathId(req, "id", "Product")))) },
    { method: "delete", path: "/admin/products/:id", handler: view("catalog:manage", async (ctx, req, res) => {
      await service.deleteProduct(ctx, pathId(req, "id", "Product"));
      sendData(res, ok);
    }) },

    // variants
    { method: "post", path: "/admin/products/:id/variants", handler: view("catalog:manage", async (_c, req, res) => sendData(res, await service.addVariant(pathId(req, "id", "Product"), parse(variantCreate, req.body)), 201)) },
    { method: "put", path: "/admin/products/:id/variants/:variantId", handler: view("catalog:manage", async (_c, req, res) =>
      sendData(res, await service.updateVariant(pathId(req, "id", "Product"), pathId(req, "variantId", "Variant"), parse(variantUpdate, req.body)))) },
    { method: "delete", path: "/admin/products/:id/variants/:variantId", handler: view("catalog:manage", async (_c, req, res) =>
      sendData(res, await service.deactivateVariant(pathId(req, "id", "Product"), pathId(req, "variantId", "Variant")))) },

    // images
    { method: "post", path: "/admin/products/:id/images", handler: view("catalog:manage", async (_c, req, res) =>
      sendData(res, await service.attachImage(pathId(req, "id", "Product"), parse(imageAttach, req.body)), 201)) },
    { method: "put", path: "/admin/products/:id/images/order", handler: view("catalog:manage", async (_c, req, res) =>
      sendData(res, await service.reorderImages(pathId(req, "id", "Product"), parse(imageOrder, req.body).orderedMediaIds))) },
    { method: "delete", path: "/admin/products/:id/images/:mediaId", handler: view("catalog:manage", async (ctx, req, res) => {
      await service.removeImage(ctx, pathId(req, "id", "Product"), pathId(req, "mediaId", "Image"));
      sendData(res, ok);
    }) },

    // export (phase 3 in the spec, cheap enough to ship now)
    { method: "get", path: "/admin/catalog/export", handler: view("catalog:manage", async (ctx, _req, res) => {
      res.status(200).type("text/csv").send(await service.exportCsv(ctx));
    }) },
  ];
}
