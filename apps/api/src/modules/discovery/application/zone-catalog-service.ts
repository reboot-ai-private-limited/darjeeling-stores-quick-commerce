import type { Geography, GeoZone } from "../../../platform/geography.js";
import { notFound, validation, type Category, type FoodType, type Product } from "../../catalog/catalog.public.js";
import type { Offering } from "../../offerings/offerings.public.js";
import type { BannerSource, CatalogReader, DiscoverySettings, MediaUrls, StoreSettings, ZoneOfferingsSource } from "./ports.js";
import { latestRev, resolveProduct, sellersOf, type ZoneContext, type ZoneProduct } from "./zone-product.js";

const HOME_SECTIONS = 6;
const SECTION_SIZE = 10;
const DEFAULT_LIMIT = 40;

export interface CategoryNode { id: string; name: string; imageUrl: string | null; children: CategoryNode[] }
export interface ProductDetail extends ZoneProduct {
  description: string; highlights: string[]; keyInfo: Product["keyInfo"]; nutrition: Product["nutrition"]; infoSections: Product["infoSections"];
}

const encodeCursor = (id: string) => Buffer.from(id).toString("base64url");
const decodeCursor = (cursor: string): string => Buffer.from(cursor, "base64url").toString();
const squash = (text: string) => text.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");

/** The customer's view of a zone's catalog (F08): what the zone sells, at one price per product, without stock numbers. */
export function createZoneCatalogService(deps: {
  geography: Geography; catalog: CatalogReader; source: ZoneOfferingsSource; media: MediaUrls; banners: BannerSource; storeSettings: StoreSettings;
  settings: DiscoverySettings; now: () => Date;
}) {
  const { geography, catalog, source, media, banners, storeSettings, settings, now } = deps;

  async function zoneOrThrow(zoneId: string): Promise<GeoZone> {
    const zone = await geography.zone(zoneId);
    if (!zone || !zone.isEnabled) throw notFound("Zone");
    return zone;
  }
  async function contextFor(zoneId: string): Promise<ZoneContext> {
    const [warehouses, brands] = await Promise.all([geography.warehousesOfZone(zoneId), catalog.listBrands()]);
    return {
      warehouses: new Map(warehouses.map(w => [w.id, w])), brands: new Map(brands.filter(b => b.isActive).map(b => [b.id, { id: b.id, name: b.name }])), zoneOpen: warehouses.some(w => w.isEnabled && w.isOpenNow), now: now(), maxQtyPerItem: settings.maxQtyPerItem,
    };
  }
  const byProduct = (offerings: readonly Offering[]) => {
    const map = new Map<string, Offering[]>();
    for (const o of offerings) map.set(o.productId, [...(map.get(o.productId) ?? []), o]);
    return map;
  };
  async function imageUrls(products: readonly Product[], extra: readonly (string | null)[] = []): Promise<Record<string, Record<string, string>>> {
    const ids = [...new Set([...products.flatMap(p => p.images.map(i => i.mediaId)), ...extra.filter((id): id is string => id !== null)])];
    return ids.length === 0 ? {} : media.urls(ids);
  }

  /** Every product the zone sells, resolved, in shelf order. Loaded once per request. */
  async function snapshot(zoneId: string) {
    const zone = await zoneOrThrow(zoneId);
    const ctx = await contextFor(zoneId);
    const offerings = byProduct(await source.zoneOfferings({ zoneId }));
    const sold = [...offerings.entries()].filter(([, list]) => sellersOf(list, ctx).length > 0).map(([id]) => id);
    const products = (await catalog.getProducts(sold)).filter(p => p.status === "active");
    const urls = await imageUrls(products);
    const resolved = products
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))
      .flatMap(product => { const entry = resolveProduct(product, offerings.get(product.id) ?? [], ctx, urls); return entry ? [{ product, entry }] : []; });
    return { zone, ctx, resolved };
  }

  /** A product belongs to its main category and to any extra ones. */
  const inCategories = (entry: ZoneProduct, ids: ReadonlySet<string>) => entry.categoryIds.some(id => ids.has(id));
  const visible = (entry: ZoneProduct) => settings.showOutOfStockItems || entry.available;

  /** Active categories that have something to sell somewhere beneath them, as a tree. */
  function categoryTree(categories: readonly Category[], sellableCategoryIds: ReadonlySet<string>, imageUrlOf: (c: Category) => string | null): { tree: CategoryNode[]; keep: Map<string, Category> } {
    const active = categories.filter(c => c.isActive);
    const children = new Map<string | null, Category[]>();
    for (const c of active) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c]);
    const order = (a: Category, b: Category) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
    const keep = new Map<string, Category>();
    const build = (parent: string | null): CategoryNode[] => (children.get(parent) ?? []).sort(order).flatMap(c => {
      const nested = build(c.id);
      if (!sellableCategoryIds.has(c.id) && nested.length === 0) return [];
      keep.set(c.id, c);
      return [{ id: c.id, name: c.name, imageUrl: imageUrlOf(c), children: nested }];
    });
    return { tree: build(null), keep };
  }
  /** The category and every category below it. */
  function subtree(categories: readonly Category[], rootId: string): Set<string> {
    const ids = new Set([rootId]);
    for (let grew = true; grew;) {
      grew = false;
      for (const c of categories) if (c.parentId !== null && ids.has(c.parentId) && !ids.has(c.id)) { ids.add(c.id); grew = true; }
    }
    return ids;
  }
  async function categoryView(categories: Category[], resolved: { product: Product; entry: ZoneProduct }[]) {
    const urls = await imageUrls([], categories.map(c => c.imageMediaId));
    return categoryTree(categories, new Set(resolved.flatMap(r => r.entry.categoryIds)), c => (c.imageMediaId ? urls[c.imageMediaId]?.["320"] ?? null : null));
  }

  return {
    async home(zoneId: string) {
      // Read the revision first: anything that changes afterwards has a higher one, so the app's delta sync cannot miss it.
      const rev = await source.currentRevision();
      const { zone, ctx, resolved } = await snapshot(zoneId);
      const [categories, store, bannerList] = await Promise.all([catalog.listCategories(), storeSettings.forZone(zoneId), banners.forZone(zoneId)]);
      const { tree } = await categoryView(categories, resolved);
      const bannerUrls = await imageUrls([], bannerList.map(b => b.imageMediaId));
      const sections = tree.slice(0, HOME_SECTIONS).flatMap(root => {
        const ids = subtree(categories, root.id);
        const products = resolved.filter(r => inCategories(r.entry, ids) && visible(r.entry)).slice(0, SECTION_SIZE).map(r => r.entry);
        return products.length > 0 ? [{ title: root.name, categoryId: root.id, products }] : [];
      });
      return {
        zone: { id: zone.id, name: zone.name },
        status: { accepting: ctx.zoneOpen && !zone.isPaused, etaMinMinutes: store.etaMinMinutes, etaMaxMinutes: store.etaMaxMinutes },
        notices: store.notices.map(({ type, label }) => ({ type, label })),
        banners: bannerList.map(b => ({ id: b.id, title: b.title, image: b.imageMediaId ? { mediaId: b.imageMediaId, urls: bannerUrls[b.imageMediaId] ?? {} } : null, link: b.link })),
        categories: tree.map(({ id, name, imageUrl }) => ({ id, name, imageUrl })),
        sections, rev,
      };
    },

    async categories(zoneId: string): Promise<CategoryNode[]> {
      const { resolved } = await snapshot(zoneId);
      return (await categoryView(await catalog.listCategories(), resolved)).tree;
    },

    async products(zoneId: string, query: {
      categoryId?: string | undefined; brandId?: string | undefined; foodType?: FoodType | undefined; limit?: number | undefined; cursor?: string | undefined; inStockOnly?: boolean | undefined;
    }) {
      const { resolved } = await snapshot(zoneId);
      let list = resolved;
      if (query.categoryId !== undefined) {
        const categories = await catalog.listCategories();
        if (!categories.some(c => c.id === query.categoryId && c.isActive)) throw notFound("Category");
        const ids = subtree(categories, query.categoryId);
        list = list.filter(r => inCategories(r.entry, ids));
      }
      if (query.brandId !== undefined) list = list.filter(r => r.product.brandId === query.brandId);
      if (query.foodType !== undefined) list = list.filter(r => r.product.foodType === query.foodType);
      list = list.filter(r => visible(r.entry) && (!query.inStockOnly || r.entry.available));
      let start = 0;
      if (query.cursor !== undefined) {
        const after = decodeCursor(query.cursor);
        const index = list.findIndex(r => r.product.id === after);
        if (index < 0) throw validation("Invalid cursor", { field: "cursor" });
        start = index + 1;
      }
      const limit = query.limit ?? DEFAULT_LIMIT;
      const page = list.slice(start, start + limit);
      return { items: page.map(r => r.entry), nextCursor: start + limit < list.length ? encodeCursor(page[page.length - 1]!.product.id) : null };
    },

    /** The brands that have something to sell in the zone, for a brand page. Switched-off brands are left out. */
    async brands(zoneId: string) {
      const { ctx, resolved } = await snapshot(zoneId);
      const counts = new Map<string, number>();
      for (const { entry } of resolved) if (entry.brand && visible(entry)) counts.set(entry.brand.id, (counts.get(entry.brand.id) ?? 0) + 1);
      const brands = (await catalog.listBrands()).filter(b => b.isActive && counts.has(b.id) && ctx.brands.has(b.id));
      const urls = await imageUrls([], brands.map(b => b.logoMediaId));
      return brands.map(b => ({ id: b.id, name: b.name, slug: b.slug, logoUrl: b.logoMediaId ? urls[b.logoMediaId]?.["320"] ?? null : null, productCount: counts.get(b.id)! }));
    },

    async product(zoneId: string, productId: string): Promise<ProductDetail> {
      await zoneOrThrow(zoneId);
      const [product] = await catalog.getProducts([productId]);
      if (!product) throw notFound("Product");
      const ctx = await contextFor(zoneId);
      const entry = resolveProduct(product, await source.zoneOfferings({ zoneId, productIds: [productId] }), ctx, await imageUrls([product]));
      if (!entry) throw notFound("Product");
      return { ...entry, description: product.description, highlights: product.highlights, keyInfo: product.keyInfo, nutrition: product.nutrition, infoSections: product.infoSections };
    },

    async search(zoneId: string, q: string, limit: number) {
      const { ctx, resolved } = await snapshot(zoneId);
      const key = squash(q);
      if (!key) return [];
      const lower = q.trim().toLowerCase();
      const score = (p: Product): number => {
        if (p.nameKey.startsWith(key)) return 0;
        if (p.nameKey.includes(key)) return 1;
        if (p.brandId && squash(ctx.brands.get(p.brandId)?.name ?? "").includes(key)) return 2;
        if (p.tags.some(t => squash(t).includes(key))) return 2;
        if (p.variants.some(v => v.sku.toLowerCase().includes(lower))) return 3;
        return 9;
      };
      return resolved.filter(r => visible(r.entry)).map(r => ({ r, s: score(r.product) })).filter(x => x.s < 9)
        .sort((a, b) => a.s - b.s || a.r.product.name.localeCompare(b.r.product.name)).slice(0, limit).map(x => x.r.entry);
    },

    /**
     * What changed in the zone after revision `since`: the full current entry for each product that is still sold, and a removal
     * notice for one that no longer is. When far more changed than is worth sending, the app is told to reload everything.
     */
    async changes(zoneId: string, since: number) {
      await zoneOrThrow(zoneId);
      const current = await source.currentRevision();
      const reload = { data: [] as (ZoneProduct | { id: string; deleted: true; rev: number })[], cursor: current, fullResync: true };
      // A cursor ahead of the server means the app's data is from somewhere else (for example a restored database).
      if (since > current) return reload;
      const cap = settings.maxChanges;
      const changed = await source.changedSince(zoneId, since, cap * 10 + 1);
      const ids = [...new Set(changed.map(o => o.productId))];
      if (changed.length > cap * 10 || ids.length > cap) return reload;
      if (changed.length === 0) return { data: [], cursor: Math.max(since, current), fullResync: false };

      const ctx = await contextFor(zoneId);
      const offerings = byProduct(await source.zoneOfferings({ zoneId, productIds: ids }));
      const products = new Map((await catalog.getProducts(ids)).map(p => [p.id, p]));
      const urls = await imageUrls([...products.values()]);
      const data = ids.flatMap(id => {
        const list = offerings.get(id) ?? [];
        const product = products.get(id);
        const entry = product ? resolveProduct(product, list, ctx, urls) : null;
        return [entry ?? { id, deleted: true as const, rev: latestRev(list) }];
      }).sort((a, b) => a.rev - b.rev);
      return { data, cursor: changed[changed.length - 1]!.rev, fullResync: false };
    },
  };
}

export type ZoneCatalogService = ReturnType<typeof createZoneCatalogService>;
