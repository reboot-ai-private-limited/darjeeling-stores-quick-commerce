"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { adminFetch } from "./session-client";

// Matches docs/api/F04-master-catalog.md and apps/api/src/modules/catalog/interface/schemas.ts.

export type CategoryNode = { id: string; name: string; slug: string; parentId: string | null; sortOrder: number; isActive: boolean; children?: CategoryNode[] };
export type Brand = { id: string; name: string; sortOrder: number; isActive: boolean };

type Attribute = { name: string; value: string };
type Variant = { id: string; label: string; weightGrams: number; sku: string; barcode: string | null; isActive: boolean; attributes: Attribute[] };
type KeyInfoRow = { label: string; value: string };
type InfoSection = { title: string; body: string };
type NutritionRow = { name: string; amount: number; unit: string; dailyValuePercent: number | null };
type Nutrition = { basis: "per_100g" | "per_100ml" | "per_serving"; servingSize: string | null; rows: NutritionRow[] };
type Img = { mediaId: string; alt: string; sortOrder: number; urls: Record<string, string> };
type Product = {
  id: string; name: string; slug: string; description: string; categoryId: string; extraCategoryIds: string[];
  type: "loose" | "packaged"; stockMode: "pooled_weight" | "per_variant"; tags: string[]; highlights: string[];
  keyInfo: KeyInfoRow[]; nutrition: Nutrition | null; infoSections: InfoSection[]; variants: Variant[];
  gstRate: number; hsnCode: string | null; status: "active" | "inactive" | "archived"; sortOrder: number;
  brandId: string | null; brand: { id: string; name: string } | null; foodType: string; badge: string | null;
  isReturnable: boolean; images: Img[];
};

const FOOD_TYPES = [["not_applicable", "Not food / not applicable"], ["veg", "Vegetarian"], ["non_veg", "Non-vegetarian"], ["egg", "Contains egg"], ["vegan", "Vegan"]] as const;
const BADGES = [["", "No badge"], ["bestseller", "Bestseller"], ["trending", "Trending"], ["new_launch", "New launch"], ["imported", "Imported"], ["organic", "Organic"]] as const;
const NUTRITION_UNITS = ["g", "mg", "mcg", "kcal", "kJ", "ml"];

async function call<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await adminFetch(`/api/v1/${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (body as { error?: { message?: string; details?: { path?: string; message: string }[] } }).error;
    const detail = e?.details?.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join("; ");
    throw new Error(detail ? `${e?.message ?? "Invalid request"} — ${detail}` : e?.message ?? "The request could not be completed.");
  }
  return body as T;
}
const JSON_POST = { "Content-Type": "application/json", "X-CSRF-Token": "1" };
const send = (method: string, body?: unknown): RequestInit => ({ method, headers: JSON_POST, ...(body !== undefined && { body: JSON.stringify(body) }) });

export function flattenTree(nodes: CategoryNode[], depth = 0): { id: string; label: string }[] {
  return nodes.flatMap((n) => [{ id: n.id, label: `${"— ".repeat(depth)}${n.name}${n.isActive ? "" : " (inactive)"}` }, ...flattenTree(n.children ?? [], depth + 1)]);
}
const firstUrl = (img: Img) => img.urls.thumb ?? img.urls.small ?? img.urls.medium ?? Object.values(img.urls)[0] ?? "";

const lbl: React.CSSProperties = { display: "block", fontSize: 14, fontWeight: 600 };
const section: React.CSSProperties = { border: "1px solid var(--admin-border)", borderRadius: 8, padding: 16, margin: "18px 0 0", background: "#fffdf7" };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14 };
const smallBtn: React.CSSProperties = { minHeight: 30, padding: "4px 10px", border: "1px solid #cbc5ba", borderRadius: 6, background: "#fff", cursor: "pointer" };

// ─── Variants ────────────────────────────────────────────────────────────────

type VariantDraft = { id?: string; label: string; weightGrams: string; sku: string; barcode: string; isActive: boolean; attributes: Attribute[]; autoSku?: boolean; rand?: string };
const randomCode = () => Math.random().toString(36).slice(2, 5).toUpperCase().padEnd(3, "X");
const emptyVariant = (): VariantDraft => ({ label: "", weightGrams: "", sku: "", barcode: "", isActive: true, attributes: [], autoSku: true, rand: randomCode() });
/** e.g. "Darjeeling First Flush Tea" + "500 g" -> DAR-FIR-FLU-500G-K3X (letters/digits/dashes, max 40, same pattern the API enforces). */
function genSku(productName: string, label: string, rand: string): string {
  const clean = (t: string) => t.normalize("NFKD").replace(/[^A-Za-z0-9 ]+/g, " ").trim().toUpperCase();
  const words = clean(productName).split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w.slice(0, 3));
  const size = clean(label).replace(/\s+/g, "").slice(0, 10);
  const parts = [...words, size, rand].filter(Boolean);
  const sku = parts.join("-").slice(0, 40).replace(/-+$/g, "");
  return sku.length >= 2 ? sku : `SKU-${rand}`;
}
const draftOf = (v: Variant): VariantDraft => ({ id: v.id, label: v.label, weightGrams: String(v.weightGrams), sku: v.sku, barcode: v.barcode ?? "", isActive: v.isActive, attributes: v.attributes });
const variantPayload = (d: VariantDraft, productName: string) => ({ label: d.label.trim(), weightGrams: parseInt(d.weightGrams, 10), sku: d.autoSku ? genSku(productName, d.label, d.rand ?? "") : d.sku.trim().toUpperCase(), barcode: d.barcode.trim() || null, attributes: d.attributes.filter((a) => a.name.trim() && a.value.trim()) });

function VariantFields({ d, onChange, disabled, canRemove, onRemove, productName }: { d: VariantDraft; onChange: (d: VariantDraft) => void; disabled: boolean; canRemove?: boolean; onRemove?: () => void; productName: string }) {
  const [adv, setAdv] = useState(Boolean(d.barcode) || d.attributes.length > 0);
  return (
    <div style={{ border: "1px solid var(--admin-border)", borderRadius: 8, padding: 12, background: "#fff" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
        <label style={lbl}>Label (e.g. 500 g)<input required maxLength={40} value={d.label} disabled={disabled} onChange={(e) => onChange({ ...d, label: e.target.value })} /></label>
        <label style={lbl}>Weight (grams)<input required type="number" min={1} max={100000} step={1} value={d.weightGrams} disabled={disabled} onChange={(e) => onChange({ ...d, weightGrams: e.target.value })} /></label>
        <label style={lbl}>SKU
          {d.autoSku
            ? <input readOnly value={genSku(productName, d.label, d.rand ?? "")} disabled style={{ background: "#fff7e7", color: "#8a5a00", fontFamily: "monospace" }} aria-label="Automatic SKU" />
            : <input required maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{1,39}" title="2-40 letters, digits, dots, dashes or underscores" value={d.sku} disabled={disabled} onChange={(e) => onChange({ ...d, sku: e.target.value })} style={{ textTransform: "uppercase" }} />}
          {(!d.id || d.autoSku) && <span style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400, fontSize: 13, marginTop: 4 }}><input type="checkbox" checked={!!d.autoSku} disabled={disabled} onChange={(e) => onChange({ ...d, autoSku: e.target.checked, sku: e.target.checked ? d.sku : genSku(productName, d.label, d.rand ?? "") })} /> Auto-generate SKU</span>}
        </label>
        {adv && <label style={lbl}>Barcode (optional)<input maxLength={40} value={d.barcode} disabled={disabled} onChange={(e) => onChange({ ...d, barcode: e.target.value })} /></label>}
      </div>
      {adv && d.attributes.map((a, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "end" }}>
          <label style={{ ...lbl, flex: 1 }}>Attribute name<input maxLength={30} placeholder="Flavour" value={a.name} disabled={disabled} onChange={(e) => onChange({ ...d, attributes: d.attributes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></label>
          <label style={{ ...lbl, flex: 1 }}>Value<input maxLength={60} placeholder="Chocolate" value={a.value} disabled={disabled} onChange={(e) => onChange({ ...d, attributes: d.attributes.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} /></label>
          <button type="button" style={smallBtn} disabled={disabled} onClick={() => onChange({ ...d, attributes: d.attributes.filter((_, j) => j !== i) })}>Remove</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        {!adv && <button type="button" style={smallBtn} disabled={disabled} onClick={() => setAdv(true)}>More options (barcode, attributes)</button>}
        {adv && d.attributes.length < 5 && <button type="button" style={smallBtn} disabled={disabled} onClick={() => onChange({ ...d, attributes: [...d.attributes, { name: "", value: "" }] })}>+ Attribute</button>}
        {canRemove && <button type="button" style={{ ...smallBtn, color: "#a73535" }} disabled={disabled} onClick={onRemove}>Remove variant</button>}
      </div>
    </div>
  );
}

function VariantsPanel({ product, canEdit, onChanged }: { product: Product; canEdit: boolean; onChanged: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, VariantDraft>>({});
  const [adding, setAdding] = useState<VariantDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await fn(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : "Failed."); } finally { setBusy(false); }
  }
  const save = (d: VariantDraft) => run(async () => {
    await call(`admin/products/${product.id}/variants/${d.id}`, send("PUT", { ...variantPayload(d, product.name), isActive: d.isActive }));
    setDrafts((p) => { const n = { ...p }; delete n[d.id!]; return n; });
  });

  return (
    <div style={section}>
      <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Variants ({product.variants.length})</h3>
      {error && <p role="alert" className="admin-role-error">{error}</p>}
      <div style={{ display: "grid", gap: 10 }}>
        {product.variants.map((v) => {
          const d = drafts[v.id];
          if (d) return (
            <form key={v.id} className="admin-role-form" onSubmit={(e) => { e.preventDefault(); void save(d); }}>
              <VariantFields d={d} productName={product.name} disabled={busy} onChange={(x) => setDrafts((p) => ({ ...p, [v.id]: x }))} />
              <label style={{ ...lbl, display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}><input type="checkbox" checked={d.isActive} onChange={(e) => setDrafts((p) => ({ ...p, [v.id]: { ...d, isActive: e.target.checked } }))} /> Active (sellable)</label>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="admin-role-button" disabled={busy}>Save variant</button>
                <button type="button" style={smallBtn} onClick={() => setDrafts((p) => { const n = { ...p }; delete n[v.id]; return n; })}>Cancel</button>
              </div>
            </form>
          );
          return (
            <div key={v.id} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "8px 12px", background: "#fff", border: "1px solid var(--admin-border)", borderRadius: 8, opacity: v.isActive ? 1 : 0.6 }}>
              <strong>{v.label}</strong>
              <span style={{ color: "var(--admin-muted)", fontSize: 14 }}>{v.weightGrams} g · SKU {v.sku}{v.barcode ? ` · ${v.barcode}` : ""}{v.attributes.length ? ` · ${v.attributes.map((a) => `${a.name}: ${a.value}`).join(", ")}` : ""}</span>
              {!v.isActive && <span className="admin-badge admin-badge-paused">Inactive</span>}
              {canEdit && (
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button type="button" style={smallBtn} disabled={busy} onClick={() => setDrafts((p) => ({ ...p, [v.id]: draftOf(v) }))}>Edit</button>
                  {v.isActive && product.variants.filter((x) => x.isActive).length > 1 && (
                    <button type="button" style={{ ...smallBtn, color: "#a73535" }} disabled={busy} onClick={() => run(() => call(`admin/products/${product.id}/variants/${v.id}`, send("DELETE")))}>Deactivate</button>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {canEdit && (adding ? (
        <form className="admin-role-form" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); void run(async () => { await call(`admin/products/${product.id}/variants`, send("POST", variantPayload(adding, product.name))); setAdding(null); }); }}>
          <VariantFields d={adding} productName={product.name} disabled={busy} onChange={setAdding} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="admin-role-button" disabled={busy}>Add variant</button>
            <button type="button" style={smallBtn} onClick={() => setAdding(null)}>Cancel</button>
          </div>
        </form>
      ) : <button type="button" style={{ ...smallBtn, marginTop: 12 }} onClick={() => setAdding(emptyVariant())}>+ Add variant</button>)}
    </div>
  );
}

// ─── Images (F24 media flow: upload-url → upload → complete → attach) ───────

async function uploadProductImage(productId: string, alt: string, file: File): Promise<string> {
  const ticket = await call<{ data: { mediaId: string; upload: { url: string; method: string; fields: Record<string, string> } } }>("media/upload-url", send("POST", {
    kind: "product_image", contentType: file.type || "image/jpeg", sizeBytes: file.size, ownerRef: { type: "product", id: productId },
  }));
  const { url, method, fields } = ticket.data.upload;
  const form = new FormData();
  Object.entries(fields ?? {}).forEach(([k, v]) => form.append(k, v));
  form.append("file", file);
  const put = await fetch(url, { method: method || "POST", body: form });
  if (!put.ok) throw new Error("The image could not be uploaded to storage.");
  await call("media/complete", send("POST", { mediaId: ticket.data.mediaId }));
  await call(`admin/products/${productId}/images`, send("POST", { mediaId: ticket.data.mediaId, alt }));
  return ticket.data.mediaId;
}

const dropzone: React.CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 150, width: "100%", padding: 20, boxSizing: "border-box", border: "2px dashed #e0b64a", borderRadius: 12, background: "#fffaf0", cursor: "pointer", textAlign: "center", color: "#8a5a00", fontSize: 15, fontWeight: 600 };
const hiddenInput: React.CSSProperties = { position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden", pointerEvents: "none" };
const thumbCard: React.CSSProperties = { margin: 0, width: 170, border: "1px solid var(--admin-border)", borderRadius: 10, padding: 8, background: "#fff", textAlign: "center" };
const thumbImg: React.CSSProperties = { width: "100%", height: 130, objectFit: "cover", borderRadius: 8, background: "#f7f6f3", display: "block" };

/** Big click-to-choose photo area. */
function Dropzone({ disabled, multiple, label, onFiles }: { disabled: boolean; multiple: boolean; label: string; onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false);
  return (
    <label style={{ ...dropzone, position: "relative", ...(over && { background: "#fff3cc", borderColor: "#c62828" }), ...(disabled && { opacity: 0.6, cursor: "not-allowed" }) }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) onFiles(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"))); }}>
      <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 16l4-4 4 4 3-3 5 5 M4 4h16v16H4z M9 9h.01" /></svg>
      <span>{label}</span>
      <span style={{ fontWeight: 400, fontSize: 13, color: "var(--admin-muted)" }}>Click to choose or drag &amp; drop · JPEG, PNG or WebP · up to 5 MB each</span>
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple={multiple} disabled={disabled} style={hiddenInput} onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    </label>
  );
}

/** A photo chosen in the create form, previewed from the local file. */
function QueuedPhoto({ file, main, disabled, onReplace, onRemove }: { file: File; main: boolean; disabled: boolean; onReplace: (f: File) => void; onRemove: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => { const u = URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u); }, [file]);
  return (
    <figure style={thumbCard}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={file.name} style={thumbImg} />
      <figcaption style={{ marginTop: 8, display: "grid", gap: 6 }}>
        <small style={{ color: "var(--admin-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{main ? "★ Main · " : ""}{file.name}</small>
        <span style={{ display: "flex", gap: 6, justifyContent: "center" }}>
          <label style={{ ...smallBtn, display: "inline-flex", alignItems: "center", position: "relative" }}>Replace
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} style={hiddenInput} onChange={(e) => { const f = e.target.files?.[0]; if (f) onReplace(f); e.target.value = ""; }} />
          </label>
          <button type="button" style={{ ...smallBtn, color: "#a73535" }} disabled={disabled} onClick={onRemove}>Delete</button>
        </span>
      </figcaption>
    </figure>
  );
}


function ImagesPanel({ product, canEdit, onChanged }: { product: Product; canEdit: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await fn(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : "Failed."); } finally { setBusy(false); }
  }
  const add = (files: File[]) => run(async () => {
    for (const f of files.slice(0, 20 - product.images.length)) await uploadProductImage(product.id, product.name, f);
  });
  const replace = (index: number, file: File) => run(async () => {
    const old = product.images[index]!.mediaId;
    const fresh = await uploadProductImage(product.id, product.name, file);
    await call(`admin/products/${product.id}/images/${old}`, send("DELETE"));
    // put the new photo where the old one was
    const ids = product.images.map((x) => x.mediaId).filter((id) => id !== old);
    ids.splice(index, 0, fresh);
    await call(`admin/products/${product.id}/images/order`, send("PUT", { orderedMediaIds: ids }));
  });
  function move(i: number, dir: -1 | 1) {
    const ids = product.images.map((x) => x.mediaId);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void run(() => call(`admin/products/${product.id}/images/order`, send("PUT", { orderedMediaIds: ids })));
  }

  return (
    <div style={{ ...section, margin: 0 }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Product photos ({product.images.length}/20) <small style={{ fontWeight: 400, color: "var(--admin-muted)" }}>— the first photo is the main one</small></h3>
      {error && <p role="alert" className="admin-role-error">{error}</p>}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        {product.images.map((img, i) => (
          <figure key={img.mediaId} style={thumbCard}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={firstUrl(img)} alt={img.alt || product.name} style={thumbImg} />
            {canEdit && (
              <figcaption style={{ marginTop: 8, display: "grid", gap: 6 }}>
                <small style={{ color: "var(--admin-muted)" }}>{i === 0 ? "★ Main photo" : `Photo ${i + 1}`}</small>
                <span style={{ display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
                  <button type="button" style={smallBtn} disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label="Move earlier">←</button>
                  <button type="button" style={smallBtn} disabled={busy || i === product.images.length - 1} onClick={() => move(i, 1)} aria-label="Move later">→</button>
                  <label style={{ ...smallBtn, display: "inline-flex", alignItems: "center", position: "relative", opacity: busy ? 0.6 : 1 }}>Replace
                    <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} style={hiddenInput} onChange={(e) => { const f = e.target.files?.[0]; if (f) void replace(i, f); e.target.value = ""; }} />
                  </label>
                  <button type="button" style={{ ...smallBtn, color: "#a73535" }} disabled={busy} onClick={() => { if (window.confirm("Delete this photo?")) void run(() => call(`admin/products/${product.id}/images/${img.mediaId}`, send("DELETE"))); }}>Delete</button>
                </span>
              </figcaption>
            )}
          </figure>
        ))}
      </div>
      {canEdit && product.images.length < 20 && <Dropzone disabled={busy} multiple label={busy ? "Uploading…" : product.images.length === 0 ? "Add product photos" : "Add more photos"} onFiles={(f) => void add(f)} />}
      {product.images.length === 0 && !canEdit && <p style={{ color: "var(--admin-muted)", fontSize: 14 }}>No photos.</p>}
    </div>
  );
}

// ─── Product form ────────────────────────────────────────────────────────────

function ProductForm({ product, categories, brands, canEdit, onClose, onSaved }: {
  product: Product | null; categories: CategoryNode[]; brands: Brand[]; canEdit: boolean; onClose: () => void; onSaved: (id: string, stay: boolean) => void;
}) {
  const isNew = product === null;
  const cats = flattenTree(categories);
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [extra, setExtra] = useState<string[]>(product?.extraCategoryIds ?? []);
  const [brandId, setBrandId] = useState(product?.brandId ?? "");
  const [type, setType] = useState<Product["type"]>(product?.type ?? "packaged");
  const [stockMode, setStockMode] = useState<Product["stockMode"]>(product?.stockMode ?? "per_variant");
  const [foodType, setFoodType] = useState(product?.foodType ?? "not_applicable");
  const [badge, setBadge] = useState(product?.badge ?? "");
  const [gstRate, setGstRate] = useState(String(product?.gstRate ?? 0));
  const [hsn, setHsn] = useState(product?.hsnCode ?? "");
  const [status, setStatus] = useState<"active" | "inactive">(product?.status === "active" ? "active" : "inactive");
  const [sortOrder, setSortOrder] = useState(String(product?.sortOrder ?? 0));
  const [returnable, setReturnable] = useState(product?.isReturnable ?? true);
  const [tags, setTags] = useState((product?.tags ?? []).join(", "));
  const [highlights, setHighlights] = useState((product?.highlights ?? []).join("\n"));
  const [keyInfo, setKeyInfo] = useState<KeyInfoRow[]>(product?.keyInfo ?? []);
  const [sections, setSections] = useState<InfoSection[]>(product?.infoSections ?? []);
  const [nutrition, setNutrition] = useState<Nutrition | null>(product?.nutrition ?? null);
  const [variants, setVariants] = useState<VariantDraft[]>([emptyVariant()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [more, setMore] = useState(!isNew);
  const [similar, setSimilar] = useState<{ id: string; name: string; reason: string }[] | null>(null);
  // Optional: sell it in a warehouse straight away (price + starting stock), so no second page is needed.
  type OfferVals = { mrp: string; price: string; stock: string };
  const [whs, setWhs] = useState<{ id: string; name: string; code: string }[]>([]);
  const [whId, setWhId] = useState("");
  const [offer, setOffer] = useState<OfferVals[]>([]);
  const [grams, setGrams] = useState("");
  useEffect(() => {
    if (!isNew) return;
    call<{ data: { id: string; name: string; code: string }[] }>("admin/warehouses").then((b) => setWhs(b.data)).catch(() => setWhs([]));
  }, [isNew]);
  const offerOf = (i: number): OfferVals => offer[i] ?? { mrp: "", price: "", stock: "" };
  const setOfferAt = (i: number, patch: Partial<OfferVals>) => setOffer((o) => { const n = variants.map((_, k) => o[k] ?? { mrp: "", price: "", stock: "" }); n[i] = { ...n[i]!, ...patch }; return n; });
  const readOnly = !canEdit;

  /** Builds the warehouse offer body for the new product's saved variants, or throws a readable message. */
  function offerBody(productId: string, savedVariantIds: string[]) {
    const pooled = stockMode === "pooled_weight";
    const rows = savedVariantIds.map((variantId, i) => {
      const x = offerOf(i);
      const mrp = Math.round(parseFloat(x.mrp) * 100), price = Math.round(parseFloat(x.price) * 100);
      const label = variants[i]?.label || `Variant ${i + 1}`;
      if (!(mrp >= 1) || !(price >= 1)) throw new Error(`${label}: enter MRP and selling price for the warehouse.`);
      if (price > mrp) throw new Error(`${label}: selling price cannot exceed MRP.`);
      return { variantId, mrp, price, stock: pooled ? null : Math.max(0, Math.floor(Number(x.stock) || 0)) };
    });
    return { warehouseId: whId, productId, stockGrams: pooled ? Math.max(0, Math.floor(Number(grams) || 0)) : null, variants: rows };
  }

  function payload() {
    const base = {
      name: name.trim(), description: description.trim(), categoryId, extraCategoryIds: extra.filter((x) => x !== categoryId),
      brandId: brandId || null, type, stockMode, foodType, badge: badge || null, gstRate: Number(gstRate) || 0,
      hsnCode: hsn.trim() || null, status, sortOrder: parseInt(sortOrder, 10) || 0, isReturnable: returnable,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      highlights: highlights.split("\n").map((t) => t.trim()).filter(Boolean),
      keyInfo: keyInfo.filter((r) => r.label.trim() && r.value.trim()),
      infoSections: sections.filter((s) => s.title.trim() && s.body.trim()),
      nutrition: nutrition && nutrition.rows.length > 0 ? { ...nutrition, servingSize: nutrition.servingSize?.trim() || null, rows: nutrition.rows.filter((r) => r.name.trim()) } : null,
    };
    return isNew ? { ...base, variants: variants.map((v) => variantPayload(v, name)) } : base;
  }

  async function submit(e: FormEvent, ignoreDuplicates = false) {
    e.preventDefault();
    setError("");
    if (!categoryId) { setError("Choose a category."); return; }
    setBusy(true);
    try {
      if (isNew && !ignoreDuplicates) {
        const dup = await call<{ data: { similar: { id: string; name: string; reason: string }[] } }>("admin/products/check-duplicate", send("POST", { name: name.trim(), skus: variants.map((v) => variantPayload(v, name).sku).filter(Boolean) }));
        if (dup.data.similar.length > 0) { setSimilar(dup.data.similar); return; }
      }
      setSimilar(null);
      const res = await call<{ data: { id: string; variants?: { id: string }[] } }>(isNew ? "admin/products" : `admin/products/${product.id}`, send(isNew ? "POST" : "PUT", payload()));
      let failed = 0;
      for (const file of photos) { try { await uploadProductImage(res.data.id, name.trim(), file); } catch { failed++; } }
      if (failed > 0) window.alert(`${photos.length - failed} of ${photos.length} photos uploaded. ${failed} failed — add them again from the Images section below.`);
      if (isNew && whId) {
        try { await call("admin/warehouse-products", send("POST", offerBody(res.data.id, (res.data.variants ?? []).map((v) => v.id)))); }
        catch (err) { window.alert(`The product was saved, but it could not be added to the warehouse: ${err instanceof Error ? err.message : "unknown error"}. Add it from Offerings & stock.`); }
      }
      onSaved(res.data.id, isNew); // a new product stays open so more can be edited
    } catch (err) {
      setError(err instanceof Error ? err.message : "The product could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const dis = busy || readOnly;
  return (
    <>
      {!isNew && product && <div className="admin-panel" style={{ padding: 24, marginBottom: 18 }}><h2 style={{ margin: "0 0 14px", fontSize: 18 }}>{product.name}</h2><ImagesPanel product={product} canEdit={canEdit} onChanged={() => onSaved(product.id, true)} /></div>}
      <form className="admin-panel admin-role-form" onSubmit={(e) => void submit(e)} aria-label={isNew ? "Create product" : "Edit product"}>
        <h2>{isNew ? "New product" : `Edit — ${product.name}`}</h2>
        {error && <p role="alert" className="admin-role-error" style={{ marginBottom: 14 }}>{error}</p>}
        {similar && (
          <div role="alert" style={{ background: "#fff7e7", border: "1px solid #f5d57a", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 15 }}>
            <strong>Possible duplicate{similar.length > 1 ? "s" : ""}:</strong>
            <ul style={{ margin: "6px 0 10px 18px" }}>{similar.map((s) => <li key={s.id}>{s.name} — {s.reason === "sku_exists" ? "a SKU is already used" : "similar name"}</li>)}</ul>
            <button type="button" className="admin-role-button" disabled={busy} onClick={(e) => void submit(e, true)}>Create anyway</button>
          </div>
        )}

        {isNew && (
          <div style={{ ...section, margin: "0 0 18px" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Product photos ({photos.length}/10) <small style={{ fontWeight: 400, color: "var(--admin-muted)" }}>— the first photo is the main one</small></h3>
            {photos.length > 0 && (
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
                {photos.map((f, i) => <QueuedPhoto key={`${f.name}-${f.size}-${i}`} file={f} main={i === 0} disabled={dis} onReplace={(nf) => setPhotos(photos.map((x, j) => (j === i ? nf : x)))} onRemove={() => setPhotos(photos.filter((_, j) => j !== i))} />)}
              </div>
            )}
            {photos.length < 10 && <Dropzone disabled={dis} multiple label={photos.length === 0 ? "Add product photos" : "Add more photos"} onFiles={(f) => setPhotos([...photos, ...f].slice(0, 10))} />}
            <p style={{ fontSize: 14, color: "var(--admin-muted)", margin: "10px 0 0" }}>Photos upload when you click “Create product”.</p>
          </div>
        )}

        <div style={grid}>
          <label style={lbl}>Product name<input required maxLength={120} value={name} disabled={dis} onChange={(e) => setName(e.target.value)} placeholder="e.g. Darjeeling First Flush Tea" /></label>
          <label style={lbl}>Main category<select required value={categoryId} disabled={dis} onChange={(e) => setCategoryId(e.target.value)}><option value="">Select a category</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
          <label style={lbl}>Brand<select value={brandId} disabled={dis} onChange={(e) => setBrandId(e.target.value)}><option value="">No brand</option>{brands.filter((b) => b.isActive || b.id === brandId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label style={lbl}>Status<select value={status} disabled={dis} onChange={(e) => setStatus(e.target.value as "active" | "inactive")}><option value="inactive">Inactive (hidden)</option><option value="active">Active (visible)</option></select></label>
        </div>

        {isNew && (
          <div style={{ ...section, margin: "18px 0 0" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Variants (at least 1, up to 20)</h3>
            <div style={{ display: "grid", gap: 10 }}>
              {variants.map((v, i) => <VariantFields key={i} d={v} productName={name} disabled={dis} onChange={(x) => setVariants(variants.map((y, j) => (j === i ? x : y)))} canRemove={variants.length > 1} onRemove={() => setVariants(variants.filter((_, j) => j !== i))} />)}
            </div>
            {variants.length < 20 && <button type="button" style={{ ...smallBtn, marginTop: 10 }} disabled={dis} onClick={() => setVariants([...variants, emptyVariant()])}>+ Add variant</button>}
          </div>
        )}

        {isNew && whs.length > 0 && (
          <div style={{ ...section, margin: "18px 0 0" }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>Sell in a warehouse <small style={{ fontWeight: 400, color: "var(--admin-muted)" }}>— optional, saves a trip to Offerings &amp; stock</small></h3>
            <label style={lbl}>Warehouse
              <select value={whId} disabled={dis} onChange={(e) => setWhId(e.target.value)}>
                <option value="">Not now — add it later</option>
                {whs.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
              </select>
            </label>
            {whId && (
              <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                {variants.map((v, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                    <span style={{ width: 130, fontSize: 14, fontWeight: 600 }}>{v.label || `Variant ${i + 1}`}</span>
                    <label style={{ ...lbl, width: 110 }}>MRP ₹<input type="number" min="0" step="0.01" value={offerOf(i).mrp} disabled={dis} onChange={(e) => setOfferAt(i, { mrp: e.target.value })} /></label>
                    <label style={{ ...lbl, width: 110 }}>Price ₹<input type="number" min="0" step="0.01" value={offerOf(i).price} disabled={dis} onChange={(e) => setOfferAt(i, { price: e.target.value })} /></label>
                    {stockMode !== "pooled_weight" && <label style={{ ...lbl, width: 110 }}>Stock<input type="number" min="0" step="1" value={offerOf(i).stock} disabled={dis} onChange={(e) => setOfferAt(i, { stock: e.target.value })} /></label>}
                  </div>
                ))}
                {stockMode === "pooled_weight" && <label style={{ ...lbl, width: 180 }}>Stock (grams, shared by all variants)<input type="number" min="0" step="1" value={grams} disabled={dis} onChange={(e) => setGrams(e.target.value)} /></label>}
                <p style={{ margin: 0, fontSize: 13, color: "var(--admin-muted)" }}>Customers only see it once the product Status is “Active”.</p>
              </div>
            )}
          </div>
        )}

        <button type="button" onClick={() => setMore(!more)} aria-expanded={more} style={{ ...smallBtn, marginTop: 18, width: "100%", minHeight: 40, background: "#fffaf0", borderColor: "#e0b64a", color: "#8a5a00", fontWeight: 600 }}>
          {more ? "▲ Hide extra details" : "▼ More details (optional): description, tax, tags, nutrition…"}
        </button>
        {more && (
          <>
        <label style={{ ...lbl, marginTop: 14 }}>Description<textarea maxLength={2000} value={description} disabled={dis} onChange={(e) => setDescription(e.target.value)} placeholder="Shown on the product page (up to 2000 characters)" /></label>

        <div style={{ ...grid, marginTop: 14 }}>
          <label style={lbl}>Type<select value={type} disabled={dis} onChange={(e) => setType(e.target.value as Product["type"])}><option value="packaged">Packaged</option><option value="loose">Loose (sold by weight)</option></select></label>
          <label style={lbl}>Stock mode<select value={stockMode} disabled={dis} onChange={(e) => setStockMode(e.target.value as Product["stockMode"])}><option value="per_variant">Per variant</option><option value="pooled_weight">Pooled weight</option></select></label>
          <label style={lbl}>Food type<select value={foodType} disabled={dis} onChange={(e) => setFoodType(e.target.value)}>{FOOD_TYPES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
          <label style={lbl}>Badge<select value={badge} disabled={dis} onChange={(e) => setBadge(e.target.value)}>{BADGES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
          <label style={lbl}>GST rate (%)<input type="number" min={0} max={28} step="any" value={gstRate} disabled={dis} onChange={(e) => setGstRate(e.target.value)} /></label>
          <label style={lbl}>HSN code (4–8 digits)<input inputMode="numeric" pattern="\d{4,8}" title="4 to 8 digits" value={hsn} disabled={dis} onChange={(e) => setHsn(e.target.value)} placeholder="Optional" /></label>
          <label style={lbl}>Sort order<input type="number" min={0} step={1} value={sortOrder} disabled={dis} onChange={(e) => setSortOrder(e.target.value)} /></label>
        </div>

        <label style={{ ...lbl, marginTop: 14 }}>Also show under (up to 5 more categories — hold Ctrl/Cmd to select several)
          <select multiple size={Math.min(6, Math.max(3, cats.length))} value={extra} disabled={dis} onChange={(e) => setExtra(Array.from(e.target.selectedOptions).map((o) => o.value).slice(0, 5))}>
            {cats.filter((c) => c.id !== categoryId).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label style={{ ...lbl, display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}><input type="checkbox" checked={returnable} disabled={dis} onChange={(e) => setReturnable(e.target.checked)} /> Returnable once delivered (damaged or missing items are always refunded)</label>

        <div style={section}>
          <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Product information</h3>
          <label style={lbl}>Tags (comma separated, up to 20)<input value={tags} disabled={dis} onChange={(e) => setTags(e.target.value)} placeholder="tea, organic, gift" /></label>
          <label style={{ ...lbl, marginTop: 12 }}>Highlights (one per line, up to 6)<textarea value={highlights} disabled={dis} onChange={(e) => setHighlights(e.target.value)} placeholder={"Hand-picked leaves\nNo added colour"} /></label>

          <h4 style={{ margin: "16px 0 8px", fontSize: 15 }}>Key information (up to 15)</h4>
          {keyInfo.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "end" }}>
              <label style={{ ...lbl, flex: 1 }}>Label<input maxLength={40} value={r.label} disabled={dis} onChange={(e) => setKeyInfo(keyInfo.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Shelf life" /></label>
              <label style={{ ...lbl, flex: 2 }}>Value<input maxLength={200} value={r.value} disabled={dis} onChange={(e) => setKeyInfo(keyInfo.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="12 months" /></label>
              <button type="button" style={smallBtn} disabled={dis} onClick={() => setKeyInfo(keyInfo.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          {keyInfo.length < 15 && <button type="button" style={smallBtn} disabled={dis} onClick={() => setKeyInfo([...keyInfo, { label: "", value: "" }])}>+ Key info row</button>}

          <h4 style={{ margin: "16px 0 8px", fontSize: 15 }}>Information sections (up to 6)</h4>
          {sections.map((s, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
                <label style={{ ...lbl, flex: 1 }}>Title<input maxLength={60} value={s.title} disabled={dis} onChange={(e) => setSections(sections.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="Ingredients" /></label>
                <button type="button" style={smallBtn} disabled={dis} onClick={() => setSections(sections.filter((_, j) => j !== i))}>Remove</button>
              </div>
              <textarea maxLength={1000} value={s.body} disabled={dis} onChange={(e) => setSections(sections.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} placeholder="Text (up to 1000 characters)" />
            </div>
          ))}
          {sections.length < 6 && <button type="button" style={smallBtn} disabled={dis} onClick={() => setSections([...sections, { title: "", body: "" }])}>+ Section</button>}

          <h4 style={{ margin: "16px 0 8px", fontSize: 15 }}>Nutrition (optional)</h4>
          {nutrition ? (
            <>
              <div style={grid}>
                <label style={lbl}>Basis<select value={nutrition.basis} disabled={dis} onChange={(e) => setNutrition({ ...nutrition, basis: e.target.value as Nutrition["basis"] })}><option value="per_100g">Per 100 g</option><option value="per_100ml">Per 100 ml</option><option value="per_serving">Per serving</option></select></label>
                <label style={lbl}>Serving size<input maxLength={40} value={nutrition.servingSize ?? ""} disabled={dis} onChange={(e) => setNutrition({ ...nutrition, servingSize: e.target.value })} placeholder="e.g. 30 g" /></label>
              </div>
              {nutrition.rows.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "end", flexWrap: "wrap" }}>
                  <label style={{ ...lbl, flex: 2, minWidth: 120 }}>Nutrient<input maxLength={60} value={r.name} disabled={dis} onChange={(e) => setNutrition({ ...nutrition, rows: nutrition.rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder="Protein" /></label>
                  <label style={{ ...lbl, flex: 1, minWidth: 80 }}>Amount<input type="number" min={0} step="any" value={r.amount} disabled={dis} onChange={(e) => setNutrition({ ...nutrition, rows: nutrition.rows.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)) })} /></label>
                  <label style={{ ...lbl, width: 90 }}>Unit<select value={r.unit} disabled={dis} onChange={(e) => setNutrition({ ...nutrition, rows: nutrition.rows.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)) })}>{NUTRITION_UNITS.map((u) => <option key={u}>{u}</option>)}</select></label>
                  <label style={{ ...lbl, width: 100 }}>Daily %<input type="number" min={0} max={1000} step="any" value={r.dailyValuePercent ?? ""} disabled={dis} onChange={(e) => setNutrition({ ...nutrition, rows: nutrition.rows.map((x, j) => (j === i ? { ...x, dailyValuePercent: e.target.value === "" ? null : Number(e.target.value) } : x)) })} /></label>
                  <button type="button" style={smallBtn} disabled={dis} onClick={() => setNutrition({ ...nutrition, rows: nutrition.rows.filter((_, j) => j !== i) })}>Remove</button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                {nutrition.rows.length < 20 && <button type="button" style={smallBtn} disabled={dis} onClick={() => setNutrition({ ...nutrition, rows: [...nutrition.rows, { name: "", amount: 0, unit: "g", dailyValuePercent: null }] })}>+ Nutrient</button>}
                <button type="button" style={smallBtn} disabled={dis} onClick={() => setNutrition(null)}>Remove nutrition table</button>
              </div>
            </>
          ) : <button type="button" style={smallBtn} disabled={dis} onClick={() => setNutrition({ basis: "per_100g", servingSize: null, rows: [] })}>+ Add nutrition table</button>}
        </div>
          </>
        )}


        <div className="admin-role-actions" style={{ marginTop: 22, gap: 8 }}>
          {canEdit && <button className="admin-role-button" type="submit" disabled={busy}>{busy ? "Saving…" : isNew ? "Create product" : "Save changes"}</button>}
          <button type="button" disabled={busy} onClick={onClose}>{isNew ? "Cancel" : "Close"}</button>
        </div>
      </form>
      {!isNew && product && <VariantsPanel product={product} canEdit={canEdit} onChanged={() => onSaved(product.id, true)} />}
    </>
  );
}

// ─── Product list ────────────────────────────────────────────────────────────

export function ProductManager({ categories, brands, canEdit }: { categories: CategoryNode[]; brands: Brand[]; canEdit: boolean }) {
  const [rows, setRows] = useState<Product[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<Product | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const cats = flattenTree(categories);

  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: "50" });
    if (search) params.set("q", search);
    if (categoryId) params.set("categoryId", categoryId);
    if (status) params.set("status", status);
    setError("");
    call<{ data: Product[]; meta?: { nextCursor: string | null } }>(`admin/products?${params}`, { signal: controller.signal })
      .then((b) => { setRows(b.data); setCursor(b.meta?.nextCursor ?? null); })
      .catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [search, categoryId, status, attempt]);

  async function loadMore() {
    if (!cursor) return;
    const params = new URLSearchParams({ limit: "50", cursor });
    if (search) params.set("q", search);
    if (categoryId) params.set("categoryId", categoryId);
    if (status) params.set("status", status);
    try {
      const b = await call<{ data: Product[]; meta?: { nextCursor: string | null } }>(`admin/products?${params}`);
      setRows((r) => [...(r ?? []), ...b.data]);
      setCursor(b.meta?.nextCursor ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load more."); }
  }

  async function openProduct(id: string) {
    try { setOpen((await call<{ data: Product }>(`admin/products/${id}`)).data); } catch (e) { setError(e instanceof Error ? e.message : "Could not load the product."); }
  }
  async function act(p: Product, action: "archive" | "restore" | "delete") {
    if (action !== "restore" && !window.confirm(action === "delete" ? `Delete "${p.name}" permanently? This cannot be undone.` : `Archive "${p.name}"? It will be hidden from customers.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await call(action === "delete" ? `admin/products/${p.id}` : `admin/products/${p.id}/${action}`, send(action === "delete" ? "DELETE" : "POST"));
      setNotice(action === "delete" ? "Product deleted." : action === "archive" ? "Product archived." : "Product restored.");
      setAttempt((n) => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Action failed."); } finally { setBusy(false); }
  }

  if (open) {
    return (
      <ProductForm
        key={open === "new" ? "new" : open.id}
        product={open === "new" ? null : open}
        categories={categories} brands={brands} canEdit={canEdit}
        onClose={() => { setOpen(null); setAttempt((n) => n + 1); }}
        onSaved={(id, stay) => { setNotice("Product saved."); setAttempt((n) => n + 1); if (stay) void openProduct(id); else setOpen(null); }}
      />
    );
  }

  const catName = (id: string) => cats.find((c) => c.id === id)?.label.replace(/^(— )+/, "") ?? "—";
  return (
    <section className="admin-panel" aria-labelledby="products-title">
      <div className="admin-panel-toolbar">
        <h2 id="products-title">Products</h2>
        {canEdit && <button className="admin-role-button" onClick={() => setOpen("new")}>+ New product</button>}
      </div>
      <div className="admin-staff-filters" style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "12px 24px" }}>
        <label style={lbl}>Search<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product name" /></label>
        <label style={lbl}>Category<select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label style={lbl}>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Active &amp; inactive</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></label>
      </div>
      {notice && <p role="status" style={{ margin: "0 24px 12px", color: "#137333", fontSize: 15 }}>{notice}</p>}
      {error && <p role="alert" className="admin-role-error" style={{ margin: "0 24px 12px" }}>{error} <button onClick={() => setAttempt((n) => n + 1)}>Retry</button></p>}
      {rows === null && !error ? <p className="admin-roles-message">Loading products…</p> : rows && rows.length === 0 ? (
        <p className="admin-roles-message">No products found{search || categoryId || status ? " for these filters" : " yet"}.{canEdit && !search && !categoryId && !status ? " Create the first one with “New product”." : ""}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="admin-product-table" style={{ width: "100%" }}>
            <thead><tr><th></th><th>Product</th><th>Category</th><th>Brand</th><th>GST</th><th>Variants</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows?.map((p) => (
                <tr key={p.id}>
                  <td style={{ width: 52 }}>{p.images[0] ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={firstUrl(p.images[0])} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6 }} /> : <span style={{ display: "inline-block", width: 40, height: 40, borderRadius: 6, background: "#fff3cc" }} />}</td>
                  <td><strong>{p.name}</strong><br /><small style={{ color: "var(--admin-muted)" }}>{p.variants.filter((v) => v.isActive).map((v) => v.label).join(" · ")}</small></td>
                  <td>{catName(p.categoryId)}</td>
                  <td>{p.brand?.name ?? "—"}</td>
                  <td>{p.gstRate}%</td>
                  <td>{p.variants.length}</td>
                  <td><span className={`admin-badge ${p.status === "active" ? "" : "admin-badge-paused"}`}>{p.status}</span></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button style={smallBtn} onClick={() => void openProduct(p.id)}>{canEdit ? "Edit" : "View"}</button>{" "}
                    {canEdit && (p.status === "archived"
                      ? <button style={smallBtn} disabled={busy} onClick={() => void act(p, "restore")}>Restore</button>
                      : <button style={smallBtn} disabled={busy} onClick={() => void act(p, "archive")}>Archive</button>)}{" "}
                    {canEdit && <button style={{ ...smallBtn, color: "#a73535" }} disabled={busy} onClick={() => void act(p, "delete")}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cursor && <div style={{ padding: 16, textAlign: "center" }}><button style={smallBtn} onClick={() => void loadMore()}>Load more</button></div>}
        </div>
      )}
    </section>
  );
}

// ─── Brands ──────────────────────────────────────────────────────────────────

export function BrandManager({ brands, canEdit, onChanged }: { brands: Brand[]; canEdit: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<Brand | "new" | null>(null);
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function start(b: Brand | "new") {
    setEditing(b); setError("");
    setName(b === "new" ? "" : b.name); setSortOrder(b === "new" ? String(brands.length) : String(b.sortOrder)); setIsActive(b === "new" ? true : b.isActive);
  }
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const body = { name: name.trim(), sortOrder: parseInt(sortOrder, 10) || 0 };
      if (editing === "new") await call("admin/brands", send("POST", body));
      else if (editing) await call(`admin/brands/${editing.id}`, send("PUT", { ...body, isActive }));
      setEditing(null); onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "The brand could not be saved."); } finally { setBusy(false); }
  }
  async function remove(b: Brand) {
    if (!window.confirm(`Delete brand "${b.name}"?`)) return;
    setBusy(true); setError("");
    try { await call(`admin/brands/${b.id}`, send("DELETE")); onChanged(); } catch (err) { setError(err instanceof Error ? err.message : "The brand could not be deleted."); } finally { setBusy(false); }
  }

  return (
    <section className="admin-panel" aria-labelledby="brands-title">
      <div className="admin-panel-toolbar">
        <h2 id="brands-title">Brands</h2>
        {canEdit && !editing && <button className="admin-role-button" onClick={() => start("new")}>+ New brand</button>}
      </div>
      {error && <p role="alert" className="admin-role-error" style={{ margin: "0 24px 12px" }}>{error}</p>}
      {editing && (
        <form className="admin-role-form" style={{ padding: "0 24px 20px" }} onSubmit={save}>
          <div style={grid}>
            <label style={lbl}>Brand name<input required maxLength={120} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} /></label>
            <label style={lbl}>Sort order<input type="number" min={0} step={1} value={sortOrder} disabled={busy} onChange={(e) => setSortOrder(e.target.value)} /></label>
          </div>
          {editing !== "new" && <label style={{ ...lbl, display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active</label>}
          <div className="admin-role-actions" style={{ marginTop: 16, gap: 8 }}>
            <button className="admin-role-button" disabled={busy}>{busy ? "Saving…" : "Save brand"}</button>
            <button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}
      {brands.length === 0 ? <p className="admin-roles-message">No brands yet.</p> : (
        <div className="admin-tree">
          {brands.map((b) => (
            <div key={b.id} className="admin-tree-row" style={{ opacity: b.isActive ? 1 : 0.6 }}>
              <span style={{ flex: 1 }}><strong>{b.name}</strong>{!b.isActive && <small style={{ marginLeft: 8 }}>inactive</small>}</span>
              {canEdit && <div className="admin-role-actions" style={{ padding: 0, gap: 6 }}>
                <button style={smallBtn} disabled={busy} onClick={() => start(b)}>Edit</button>
                <button style={{ ...smallBtn, color: "#a73535" }} disabled={busy} onClick={() => void remove(b)}>Delete</button>
              </div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
