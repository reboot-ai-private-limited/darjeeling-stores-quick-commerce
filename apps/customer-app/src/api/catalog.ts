import { api } from "./http";

export type Variant = {
  variantId: string; label: string; weightGrams?: number; price: number; mrp: number;
  discountAmount: number; discountPercent: number; onSale: boolean; saleEndsAt: string | null; available: boolean; maxQty: number;
};
export type ProductImage = { mediaId: string; alt?: string; urls: Record<string, string> };
export type Product = {
  id: string; name: string; slug: string; categoryId: string; tags?: string[];
  images: ProductImage[]; variants: Variant[]; available: boolean; availability: "in_stock" | "out_of_stock" | "closed";
  badge?: string | null; foodType?: string | null; brand?: { id: string; name: string } | null;
};
export type Banner = { id: string; title: string; image: { mediaId: string; urls: Record<string, string> } | null; link: { type: "category" | "product" | "url"; id?: string; url?: string } | null };
export type Category = { id: string; name: string; imageUrl: string | null; children?: Category[] };
export type Notice = { type: string; label: string };
export type Home = {
  zone: { id: string; name: string };
  status: { accepting: boolean; etaMinMinutes: number; etaMaxMinutes: number };
  notices: Notice[]; banners: Banner[]; categories: Category[];
  sections: { title: string; categoryId: string; products: Product[] }[];
  rev: number;
};

/** The category tree of each zone from the last time it loaded, so screens that need it can draw at once and refresh quietly. */
const categoryCache = new Map<string, Category[]>();
export const cachedCategories = (zoneId: string | undefined): Category[] => (zoneId ? categoryCache.get(zoneId) ?? [] : []);

export const getHome = (zoneId: string) => api<Home>("GET", `/catalog/home?zoneId=${zoneId}`, undefined, { auth: false }).then(r => { categoryCache.set(zoneId, r.data.categories); return r.data; });
export const getCategories = (zoneId: string) => api<Category[]>("GET", `/catalog/categories?zoneId=${zoneId}`, undefined, { auth: false }).then(r => { categoryCache.set(zoneId, r.data); return r.data; });
export const searchProducts = (zoneId: string, q: string) =>
  api<Product[]>("GET", `/catalog/search?zoneId=${zoneId}&q=${encodeURIComponent(q)}&limit=30`, undefined, { auth: false }).then(r => r.data);

/** The picture to show on a card (the 320 px size, or the nearest one that exists). */
export const cardImage = (p: Product): string | null => {
  const u = p.images[0]?.urls; if (!u) return null;
  return u["320"] ?? u["640"] ?? u["160"] ?? u["1080"] ?? null;
};
/** The size to add from a card: the first one that can be bought, else the first. */
export const defaultVariant = (p: Product): Variant | undefined => p.variants.find(v => v.available) ?? p.variants[0];

/**
 * Picture for each top-level category: its own image if an admin uploaded one, otherwise the first product photo
 * from that category's shelf on Home. The flag says which, so the tile can crop a real category image but fit a product photo.
 */
export const categoryPictures = (cats: Category[], sections: Home["sections"]): Record<string, { uri: string; product: boolean }> => {
  const out: Record<string, { uri: string; product: boolean }> = {};
  for (const c of cats) {
    if (c.imageUrl) { out[c.id] = { uri: c.imageUrl, product: false }; continue; }
    const img = sections.find(s => s.categoryId === c.id)?.products.map(cardImage).find((u): u is string => !!u);
    if (img) out[c.id] = { uri: img, product: true };
  }
  return out;
};

export type ProductList = { items: Product[]; nextCursor: string | null };
export const getProducts = (zoneId: string, categoryId: string, cursor?: string | null) =>
  api<Product[]>("GET", `/catalog/products?zoneId=${zoneId}&categoryId=${categoryId}&limit=40${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, undefined, { auth: false })
    .then(r => ({ items: r.data, nextCursor: (r.meta?.nextCursor as string | null | undefined) ?? null }) as ProductList);

export type ProductDetail = Product & {
  description?: string | null; highlights?: string[];
  keyInfo?: { label: string; value: string }[];
  nutrition?: { basis: string; servingSize: string | null; rows: { name: string; amount: number; unit: string; dailyValuePercent: number | null }[] } | null;
  infoSections?: { title: string; body: string }[];
};
export const getProduct = (zoneId: string, id: string) => api<ProductDetail>("GET", `/catalog/products/${id}?zoneId=${zoneId}`, undefined, { auth: false }).then(r => r.data);

/** Asks to be told when an out-of-stock item is back. Needs a signed-in customer. */
export const notifyMe = (zoneId: string, productId: string, variantId?: string) =>
  api("POST", "/notify-me", { zoneId, productId, ...(variantId ? { variantId } : {}) });

/** Finds a category (or sub-category) anywhere in the tree. */
export const findCategory = (tree: Category[], id: string): Category | undefined => {
  for (const c of tree) { if (c.id === id) return c; const f = c.children && findCategory(c.children, id); if (f) return f; }
  return undefined;
};
