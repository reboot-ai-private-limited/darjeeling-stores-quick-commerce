"use client";

import { Fragment, useEffect, useState, type FormEvent } from "react";
import { adminFetch, type AdminSession } from "./session-client";

// ─── Types ───────────────────────────────────────────────────────────────────

type WarehouseOption = { id: string; name: string; code: string };

type OfferingVariant = { variantId: string; label: string; price: number; mrp: number; stock: number | null; isActive: boolean };
type Offering = { id: string; rev: number; productId: string; status: string; stockGrams: number | null; product: { name: string; type: string; stockMode: string }; variants: OfferingVariant[] };
const toPaise = (rupees: string) => Math.round(parseFloat(rupees) * 100);

type StockMovement = {
  id: string; productId: string; variantId: string | null; mode: "grams" | "units";
  delta: number; balanceAfter: number; reason: string; note: string | null; createdAt: string;
};

// ─── Helper ───────────────────────────────────────────────────────────────────

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await adminFetch(`/api/v1/admin/${path}`, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? "The request could not be completed.");
  return body;
}

function fmt(n: number) {
  return `₹${(n / 100).toFixed(2)}`; // API money is whole paise
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString();
}

// ─── Product pictures and categories (for the thumbnails and the category filter) ────────────

type Pictures = Map<string, string>;
type CategoryOption = { id: string; label: string };
type CategoryNode = { id: string; name: string; children?: CategoryNode[] };

/** One small picture per product, found by product id. The offerings data carries no photos, so they come from the products list. */
function useCatalogLookups() {
  const [pictures, setPictures] = useState<Pictures>(new Map());
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  useEffect(() => {
    let live = true;
    (async () => {
      const found: Pictures = new Map();
      let cursor = "";
      for (let page = 0; page < 20; page++) {
        const q = new URLSearchParams({ limit: "100", ...(cursor && { cursor }) });
        const body = await api<{ data: { id: string; images?: { urls?: Record<string, string> }[] }[]; meta?: { nextCursor: string | null } }>(`products?${q}`);
        for (const p of body.data) {
          const u = p.images?.[0]?.urls;
          const url = u && (u["160"] ?? u.thumb ?? u["320"] ?? u.small ?? Object.values(u)[0]);
          if (url) found.set(p.id, url);
        }
        cursor = body.meta?.nextCursor ?? "";
        if (!cursor) break;
      }
      if (live) setPictures(found);
    })().catch(() => undefined);
    api<{ data: CategoryNode[] }>("categories").then((b) => {
      if (!live) return;
      const flat: CategoryOption[] = [];
      const walk = (nodes: CategoryNode[], depth: number) => nodes.forEach((n) => { flat.push({ id: n.id, label: `${"— ".repeat(depth)}${n.name}` }); walk(n.children ?? [], depth + 1); });
      walk(b.data, 0);
      setCategories(flat);
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return { pictures, categories };
}

/** A square product photo, or a plain tile when the product has none. */
function Thumb({ src, size = 48, inline = false }: { src?: string | undefined; size?: number; inline?: boolean }) {
  const box: React.CSSProperties = { width: size, height: size, borderRadius: 8, objectFit: "cover", flexShrink: 0, background: "#fff3cc", border: "1px solid var(--admin-border)", ...(inline && { display: "inline-block", marginRight: 10, verticalAlign: "middle" }) };
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" loading="lazy" style={box} /> : <span aria-hidden="true" style={{ ...box, display: inline ? "inline-block" : "block" }} />;
}

// ─── Warehouse Picker ─────────────────────────────────────────────────────────

function WarehousePicker({
  warehouses,
  value,
  onChange,
}: {
  warehouses: WarehouseOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="admin-wh-picker">
      <label htmlFor="wh-picker" style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}>Warehouse</label>
      <select
        id="wh-picker"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— Select a warehouse —</option>
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Offerings Tab ────────────────────────────────────────────────────────────

function OfferingsTab({ warehouseId, canManage, pictures, categories, attempt, setAttempt, adding, setAdding }: { warehouseId: string; canManage: boolean; pictures: Pictures; categories: CategoryOption[]; attempt: number; setAttempt: (f: (v: number) => number) => void; adding: boolean; setAdding: (v: boolean) => void }) {
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cursors, setCursors] = useState<string[]>([""]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Filters: the server does the searching, so they work across every page.
  const [searchText, setSearchText] = useState("");
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const filtered = !!(q || categoryId || statusFilter || lowOnly);
  useEffect(() => { const t = setTimeout(() => setQ(searchText.trim()), 300); return () => clearTimeout(t); }, [searchText]);
  useEffect(() => { setCursors([""]); }, [q, categoryId, statusFilter, lowOnly, warehouseId]);

  // Add products (one panel: pick products, set price + stock, save once)
  type Vals = { mrp: string; price: string; stock: string };
  const [catalog, setCatalog] = useState<{ id: string; name: string; stockMode: string; variants: { id: string; label: string; sku: string }[] }[]>([]);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [vals, setVals] = useState<Record<string, Vals>>({});
  const [fill, setFill] = useState<Vals>({ mrp: "", price: "", stock: "" });
  const [addError, setAddError] = useState("");

  // Edit offering
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMrp, setEditMrp] = useState("");
  const [editSelling, setEditSelling] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editError, setEditError] = useState("");

  // Stock manager: adjust one offering's stock right in its row, and see its recent movements.
  const [stockKey, setStockKey] = useState<string | null>(null);
  const [stockMode, setStockMode] = useState<"add" | "remove">("add");
  const [stockQty, setStockQty] = useState("");
  const [stockReason, setStockReason] = useState("purchase");
  const [stockNote, setStockNote] = useState("");
  const [stockError, setStockError] = useState("");
  const [history, setHistory] = useState<StockMovement[] | null>(null);
  const REASONS: Record<"add" | "remove", [string, string][]> = {
    add: [["purchase", "Stock received"], ["correction", "Correction (count was low)"]],
    remove: [["wastage", "Damaged, expired or lost"], ["correction", "Correction (count was high)"]],
  };

  function openStock(o: Offering, v: OfferingVariant) {
    const key = `${o.id}:${v.variantId}`;
    if (stockKey === key) { setStockKey(null); return; }
    setStockKey(key); setStockMode("add"); setStockQty(""); setStockReason("purchase"); setStockNote(""); setStockError(""); setHistory(null);
    api<{ data: StockMovement[] }>(`stock/movements?warehouseId=${warehouseId}&productId=${o.productId}&limit=8`)
      .then((b) => setHistory(b.data)).catch(() => setHistory([]));
  }
  async function saveStock(e: FormEvent, o: Offering, v: OfferingVariant) {
    e.preventDefault();
    setBusy(true); setStockError("");
    try {
      const qty = parseInt(stockQty, 10);
      if (!Number.isInteger(qty) || qty <= 0) throw new Error("Enter a whole number greater than zero.");
      const pooled = o.product.stockMode === "pooled_weight";
      await api("stock/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ warehouseId, productId: o.productId, variantId: pooled ? null : v.variantId, delta: stockMode === "add" ? qty : -qty, reason: stockReason, note: stockNote.trim() || null }),
      });
      setStockKey(null); setNotice(`Stock updated for ${o.product.name}.`); setAttempt((n) => n + 1);
    } catch (err) {
      setStockError(err instanceof Error ? err.message : "Stock could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  const cursor = cursors.at(-1)!;

  useEffect(() => {
    if (!warehouseId) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams({
      limit: "25", ...(cursor && { cursor }), ...(q && { q }), ...(categoryId && { categoryId }), ...(statusFilter && { status: statusFilter }), ...(lowOnly && { lowStock: "true" }),
    });
    api<{ data: Offering[]; meta: { nextCursor: string | null } }>(`warehouses/${warehouseId}/products?${params}`, { signal: controller.signal })
      .then((body) => { if (!controller.signal.aborted) { setOfferings(body.data); setNextCursor(body.meta.nextCursor); } })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Offerings could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [warehouseId, cursor, attempt, q, categoryId, statusFilter, lowOnly]);

  useEffect(() => {
    if (!adding || catalog.length) return;
    api<{ data: typeof catalog }>("products?limit=100&status=active").then((b) => setCatalog(b.data)).catch(() => setCatalog([]));
  }, [adding, catalog.length]);

  const have = new Set(offerings.map((o) => o.productId));
  const available = catalog.filter((p) => !have.has(p.id));
  const chosen = available.filter((p) => sel[p.id]);
  const valOf = (variantId: string): Vals => vals[variantId] ?? { mrp: fill.mrp, price: fill.price, stock: fill.stock };

  function toggleProduct(p: { id: string; variants: { id: string }[] }, on: boolean) {
    setSel((m) => ({ ...m, [p.id]: on }));
    if (on) setVals((m) => { const n = { ...m }; for (const v of p.variants) n[v.id] = n[v.id] ?? { mrp: fill.mrp, price: fill.price, stock: fill.stock }; return n; });
  }
  function applyFill() {
    setVals((m) => { const n = { ...m }; for (const p of chosen) for (const v of p.variants) n[v.id] = { ...fill }; return n; });
  }

  async function saveAdd(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setAddError("");
    let done = 0;
    try {
      if (chosen.length === 0) throw new Error("Tick at least one product.");
      for (const p of chosen) {
        const variants = p.variants.map((v) => {
          const x = valOf(v.id);
          const mrp = toPaise(x.mrp), price = toPaise(x.price);
          if (!(mrp >= 1) || !(price >= 1)) throw new Error(`${p.name} (${v.label}): enter MRP and selling price.`);
          if (price > mrp) throw new Error(`${p.name} (${v.label}): selling price cannot exceed MRP.`);
          // per-variant products need a stock figure (0 if left blank); pooled-weight products keep stock on the product
          const stock = p.stockMode === "pooled_weight" ? null : Math.max(0, Math.floor(Number(x.stock) || 0));
          return { variantId: v.id, price, mrp, stock };
        });
        const stockGrams = p.stockMode === "pooled_weight" ? Math.max(0, Math.floor(Number(valOf(`g:${p.id}`).stock) || 0)) : null;
        await api("warehouse-products", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
          body: JSON.stringify({ warehouseId, productId: p.id, stockGrams, variants }),
        });
        done++;
      }
      setAdding(false); setSel({}); setVals({}); setFill({ mrp: "", price: "", stock: "" });
      setNotice(`${done} product${done === 1 ? "" : "s"} added to the warehouse.`); setAttempt((v) => v + 1);
    } catch (err) {
      setAddError((done ? `${done} added before the error. ` : "") + (err instanceof Error ? err.message : "Could not add products."));
      if (done) setAttempt((v) => v + 1);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(o: Offering, variantId: string) {
    setBusy(true); setEditError("");
    try {
      const mrpP = toPaise(editMrp), priceP = toPaise(editSelling);
      if (!(mrpP >= 1) || !(priceP >= 1) || priceP > mrpP) throw new Error("Enter valid prices (selling price cannot exceed MRP).");
      await api(`warehouse-products/${o.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ rev: o.rev, variants: [{ variantId, price: priceP, mrp: mrpP, isActive: editActive }] }),
      });
      setEditingId(null); setNotice("Offering updated."); setAttempt((v) => v + 1);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(o: Offering, v: OfferingVariant) {
    setEditingId(`${o.id}:${v.variantId}`); setEditMrp(String(v.mrp / 100)); setEditSelling(String(v.price / 100)); setEditActive(v.isActive); setEditError("");
  }

  return (
    <>
      {(notice || error) && (
        <div style={{ marginBottom: 14 }}>
          {notice && <p role="status" style={{ color: "#137333", margin: 0, fontSize: 15, fontWeight: 600 }}>{notice}</p>}
          {error && <p role="alert" className="admin-role-error" style={{ margin: 0 }}>{error}</p>}
        </div>
      )}

      {adding && (
        <form className="admin-panel" onSubmit={saveAdd} style={{ marginBottom: 16, padding: 20 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Add products to this warehouse</h2>
          <p style={{ fontSize: 14, color: "var(--admin-muted)", margin: "0 0 14px" }}>Tick the products, set price and starting stock, then save once. Use “Fill selected” to set the same values for every ticked product.</p>
          {available.length === 0 ? (
            <p className="admin-roles-message">{catalog.length === 0 ? "Loading products…" : "Every active product is already in this warehouse."}</p>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12, fontSize: 14 }}>
                <strong>Fill selected:</strong>
                <input type="number" min="0" step="0.01" placeholder="MRP ₹" value={fill.mrp} onChange={(e) => setFill({ ...fill, mrp: e.target.value })} style={{ width: 96, padding: "6px 8px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit", fontSize: 14 }} />
                <input type="number" min="0" step="0.01" placeholder="Price ₹" value={fill.price} onChange={(e) => setFill({ ...fill, price: e.target.value })} style={{ width: 96, padding: "6px 8px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit", fontSize: 14 }} />
                <input type="number" min="0" step="1" placeholder="Stock" value={fill.stock} onChange={(e) => setFill({ ...fill, stock: e.target.value })} style={{ width: 96, padding: "6px 8px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit", fontSize: 14 }} />
                <button type="button" onClick={applyFill} disabled={chosen.length === 0} style={{ border: "1px solid #cbc5ba", borderRadius: 6, padding: "6px 12px", background: "#fff", cursor: "pointer", fontSize: 14 }}>Apply</button>
              </div>
              <div style={{ overflowX: "auto", maxHeight: 380, overflowY: "auto", border: "1px solid var(--admin-border)", borderRadius: 8 }}>
                <table className="admin-stock-table">
                  <thead><tr>
                    <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all" checked={chosen.length === available.length} onChange={(e) => available.forEach((p) => toggleProduct(p, e.target.checked))} /></th>
                    <th>Product / variant</th><th>MRP ₹</th><th>Price ₹</th><th>Stock</th>
                  </tr></thead>
                  <tbody>
                    {available.map((p) => (
                      <Fragment key={p.id}>
                        <tr style={{ background: "#faf8f4" }}>
                          <td><input type="checkbox" aria-label={`Select ${p.name}`} checked={!!sel[p.id]} onChange={(e) => toggleProduct(p, e.target.checked)} /></td>
                          <td colSpan={p.stockMode === "pooled_weight" && sel[p.id] ? 3 : 4} style={{ fontWeight: 600 }}><Thumb src={pictures.get(p.id)} size={36} inline />{p.name}{p.stockMode === "pooled_weight" && <small style={{ fontWeight: 400, color: "var(--admin-muted)" }}> — sold by weight</small>}</td>
                          {p.stockMode === "pooled_weight" && sel[p.id] && (
                            <td><input type="number" min="0" step="1" placeholder="Stock (g)" value={valOf(`g:${p.id}`).stock} onChange={(e) => setVals((m) => ({ ...m, [`g:${p.id}`]: { ...valOf(`g:${p.id}`), stock: e.target.value } }))} style={{ width: 96, padding: "6px 8px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit", fontSize: 14 }} /></td>
                          )}
                        </tr>
                        {sel[p.id] && p.variants.map((v) => {
                          const x = valOf(v.id);
                          const set = (patch: Partial<Vals>) => setVals((m) => ({ ...m, [v.id]: { ...valOf(v.id), ...patch } }));
                          return (
                            <tr key={v.id}>
                              <td></td>
                              <td style={{ fontSize: 14, color: "var(--admin-muted)", paddingLeft: 28 }}>{v.label}</td>
                              <td><input type="number" min="0" step="0.01" value={x.mrp} onChange={(e) => set({ mrp: e.target.value })} style={{ width: 96, padding: "6px 8px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit", fontSize: 14 }} /></td>
                              <td><input type="number" min="0" step="0.01" value={x.price} onChange={(e) => set({ price: e.target.value })} style={{ width: 96, padding: "6px 8px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit", fontSize: 14 }} /></td>
                              <td>{p.stockMode === "pooled_weight" ? <span style={{ fontSize: 13, color: "var(--admin-muted)" }}>shared</span> : <input type="number" min="0" step="1" value={x.stock} onChange={(e) => set({ stock: e.target.value })} style={{ width: 96, padding: "6px 8px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit", fontSize: 14 }} />}</td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {addError && <p role="alert" className="admin-role-error" style={{ marginTop: 10 }}>{addError}</p>}
          <div className="admin-role-actions" style={{ marginTop: 14, padding: 0 }}>
            <button className="admin-role-button" type="submit" disabled={busy || chosen.length === 0}>{busy ? "Saving…" : `Add ${chosen.length || ""} to warehouse`}</button>
            <button type="button" disabled={busy} onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      )}

      <section className="admin-panel" aria-labelledby="offerings-title">
        <div className="admin-staff-filters">
          <label>
            Search products
            <input type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Name or SKU" />
          </label>
          <label>
            Category
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label>
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label className="admin-check" style={{ flex: "0 0 auto" }}>
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
            <span>Low stock only</span>
          </label>
          {filtered && <button type="button" className="admin-text-button" onClick={() => { setSearchText(""); setQ(""); setCategoryId(""); setStatusFilter(""); setLowOnly(false); }}>Clear filters</button>}
        </div>
        <div className="admin-panel-toolbar">
          <h2 id="offerings-title">Offerings</h2>
          <span>{loading ? "Loading…" : `${offerings.length} shown`}</span>
        </div>
        {!warehouseId ? (
          <p className="admin-roles-message">Select a warehouse above to see its offerings.</p>
        ) : loading ? (
          <p className="admin-roles-message" role="status">Loading offerings…</p>
        ) : offerings.length === 0 ? (
          <p className="admin-roles-message">{filtered ? "No products match these filters." : "No products are activated for this warehouse yet."}</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="admin-stock-table">
              <thead>
                <tr>
                  <th style={{ width: 72 }}><span className="admin-sr-only">Photo</span></th>
                  <th>Product</th>
                  <th>Variant</th>
                  <th>MRP</th>
                  <th>Selling price</th>
                  <th>Stock</th>
                  <th>Status</th>
                  {canManage && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {offerings.flatMap((o) => o.variants.map((v) => {
                  const key = `${o.id}:${v.variantId}`;
                  const editing = editingId === key;
                  const small = { width: 90, padding: "5px 8px", border: "1px solid #cbc5ba", borderRadius: 4, font: "inherit", fontSize: 14 } as const;
                  const live = v.isActive && o.status === "active";
                  return (
                    <Fragment key={key}>
                    <tr>
                      <td><Thumb src={pictures.get(o.productId)} /></td>
                      <td style={{ fontWeight: 500 }}>{o.product.name}</td>
                      <td style={{ fontSize: 14, color: "var(--admin-muted)" }}>{v.label}</td>
                      <td>{editing ? <input type="number" min="0" step="0.01" value={editMrp} onChange={(e) => setEditMrp(e.target.value)} style={small} /> : fmt(v.mrp)}</td>
                      <td>{editing ? <input type="number" min="0" step="0.01" value={editSelling} onChange={(e) => setEditSelling(e.target.value)} style={small} /> : fmt(v.price)}</td>
                      <td style={{ fontWeight: 600 }}>{o.product.stockMode === "pooled_weight" ? <>{o.stockGrams ?? 0} g<small style={{ display: "block", fontWeight: 400, color: "var(--admin-muted)" }}>shared by all sizes</small></> : (v.stock ?? "—")}</td>
                      <td>
                        {editing ? (
                          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
                            <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} /> Active
                          </label>
                        ) : (
                          <span className={`admin-badge ${live ? "admin-badge-active" : "admin-badge-disabled"}`}>{live ? "Active" : "Inactive"}</span>
                        )}
                      </td>
                      {canManage && (
                        <td>
                          <div className="admin-role-actions" style={{ padding: 0, gap: 6 }}>
                            {editing ? (
                              <>
                                {editError && <span style={{ color: "#a73535", fontSize: 13 }}>{editError}</span>}
                                <button disabled={busy} onClick={() => saveEdit(o, v.variantId)} style={{ border: "1px solid #cbc5ba", borderRadius: 6, padding: "4px 10px", background: "#fff", cursor: "pointer", fontSize: 14, color: "var(--admin-accent)" }}>{busy ? "Saving…" : "Save"}</button>
                                <button disabled={busy} onClick={() => setEditingId(null)} style={{ border: "1px solid #cbc5ba", borderRadius: 6, padding: "4px 10px", background: "#fff", cursor: "pointer", fontSize: 14 }}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <button onClick={() => startEdit(o, v)} style={{ border: "1px solid #cbc5ba", borderRadius: 6, padding: "4px 10px", background: "#fff", cursor: "pointer", fontSize: 14 }}>Edit</button>
                                <button onClick={() => openStock(o, v)} style={{ border: "1px solid #e0b64a", borderRadius: 6, padding: "4px 10px", background: stockKey === key ? "#fff3cc" : "#fffaf0", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>Stock</button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                    {stockKey === key && (
                      <tr style={{ background: "#fffaf0" }}>
                        <td colSpan={canManage ? 8 : 7} style={{ padding: "16px 24px" }}>
                          <form onSubmit={(e) => void saveStock(e, o, v)} style={{ display: "grid", gap: 14 }}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
                              <strong style={{ fontSize: 15 }}>
                                {o.product.name}{o.product.stockMode === "pooled_weight" ? "" : ` · ${v.label}`}: now {o.product.stockMode === "pooled_weight" ? `${o.stockGrams ?? 0} g` : `${v.stock ?? 0} units`}
                              </strong>
                              <div className="admin-segment" role="group" aria-label="Add or remove stock" style={{ margin: 0 }}>
                                <button type="button" className={stockMode === "add" ? "is-on" : ""} onClick={() => { setStockMode("add"); setStockReason("purchase"); }}>Add stock</button>
                                <button type="button" className={stockMode === "remove" ? "is-on" : ""} onClick={() => { setStockMode("remove"); setStockReason("wastage"); }}>Remove stock</button>
                              </div>
                            </div>
                            <div className="admin-form-row" style={{ alignItems: "end" }}>
                              <label className="admin-field">
                                {o.product.stockMode === "pooled_weight" ? "Grams *" : "Units *"}
                                <input type="number" min="1" step="1" required value={stockQty} onChange={(e) => setStockQty(e.target.value)} disabled={busy} placeholder="e.g. 20" />
                              </label>
                              <label className="admin-field">
                                Reason
                                <select value={stockReason} onChange={(e) => setStockReason(e.target.value)} disabled={busy}>
                                  {REASONS[stockMode].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                </select>
                              </label>
                              <label className="admin-field">
                                Note (optional)
                                <input maxLength={200} value={stockNote} onChange={(e) => setStockNote(e.target.value)} disabled={busy} placeholder="e.g. Supplier delivery" />
                              </label>
                            </div>
                            {stockError && <p role="alert" className="admin-role-error" style={{ margin: 0 }}>{stockError}</p>}
                            <div className="admin-form-actions" style={{ margin: 0, padding: 0, border: 0 }}>
                              <button className="admin-role-button" type="submit" disabled={busy}>{busy ? "Saving…" : stockMode === "add" ? "Add to stock" : "Remove from stock"}</button>
                              <button type="button" disabled={busy} onClick={() => setStockKey(null)}>Close</button>
                            </div>
                            <div>
                              <strong style={{ fontSize: 14 }}>Recent stock changes</strong>
                              {history === null ? <p className="admin-roles-message" style={{ margin: "6px 0 0" }}>Loading…</p>
                                : history.length === 0 ? <p className="admin-roles-message" style={{ margin: "6px 0 0" }}>No stock changes yet.</p>
                                  : (
                                    <table className="admin-stock-table" style={{ marginTop: 8 }}>
                                      <thead><tr><th>When</th><th>Change</th><th>Balance</th><th>Reason</th><th>Note</th></tr></thead>
                                      <tbody>
                                        {history.map((m) => (
                                          <tr key={m.id}>
                                            <td style={{ whiteSpace: "nowrap" }}>{fmtDate(m.createdAt)}</td>
                                            <td style={{ fontWeight: 700, color: m.delta < 0 ? "#a73535" : "#137333" }}>{m.delta > 0 ? "+" : ""}{m.delta}</td>
                                            <td>{m.balanceAfter}</td>
                                            <td>{m.reason.replaceAll("_", " ")}</td>
                                            <td style={{ color: "var(--admin-muted)" }}>{m.note ?? "—"}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                            </div>
                          </form>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                }))}
              </tbody>
            </table>
          </div>
        )}
        <div className="admin-staff-pagination">
          <button disabled={loading || cursors.length <= 1} onClick={() => setCursors((v) => v.slice(0, -1))}>Previous</button>
          <span>Page {cursors.length}</span>
          <button disabled={loading || !nextCursor} onClick={() => { if (nextCursor) setCursors((v) => [...v, nextCursor]); }}>Next</button>
        </div>
      </section>
    </>
  );
}

export default function Inventory({ session }: { session: AdminSession }) {
  const lookups = useCatalogLookups();
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");

  const canManage =
    session.user.permissions.includes("*") ||
    session.user.permissions.includes("inventory:manage");
  const canView =
    canManage ||
    session.user.permissions.includes("inventory:view") ||
    session.user.permissions.includes("warehouses:view") ||
    session.user.permissions.includes("warehouses:manage");

  // The admin shell hands this page a fresh "session" object every time it re-checks the sign-in (on a timer and when the tab is
  // focused again). Only what the session says about warehouses matters here, so depend on that, not on the object itself.
  const scopeKey = session.user.scope.all ? "all" : session.user.scope.warehouseIds.join(",");
  const savedKey = "admin.inventory.warehouse";
  useEffect(() => {
    void api<{ data: WarehouseOption[] }>("warehouses").then((body) => {
      const whList = body.data;
      setWarehouses(whList);
      const accessible = session.user.scope.all ? whList : whList.filter((w) => session.user.scope.warehouseIds.includes(w.id));
      let remembered = "";
      try { remembered = window.localStorage.getItem(savedKey) ?? ""; } catch { /* storage can be blocked */ }
      // Keep the warehouse already chosen; otherwise the one used last time; otherwise the first.
      setWarehouseId((current) => {
        const stillThere = (id: string) => accessible.some((w) => w.id === id);
        return stillThere(current) ? current : stillThere(remembered) ? remembered : (accessible[0]?.id ?? "");
      });
    }).catch(() => {});
  }, [scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function chooseWarehouse(id: string) {
    setWarehouseId(id);
    try { window.localStorage.setItem(savedKey, id); } catch { /* ignore */ }
  }

  // Scope filter: scoped staff see only their warehouses
  const visibleWarehouses = session.user.scope.all
    ? warehouses
    : warehouses.filter((w) => session.user.scope.warehouseIds.includes(w.id));

  if (!canView) {
    return (
      <div className="admin-heading">
        <div><h1>Inventory</h1><p>You do not have permission to view inventory.</p></div>
      </div>
    );
  }

  return (
    <>
      <div className="admin-heading" style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1>Offerings &amp; stock</h1>
          <p>What each warehouse sells: price, availability and stock, all in one place.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="admin-text-button" onClick={() => setAttempt((v) => v + 1)}>Reload</button>
          {canManage && <button className="admin-role-button" style={{ minHeight: 44 }} onClick={() => setAdding(!adding)}>{adding ? "Close" : "+ Add products"}</button>}
        </div>
      </div>

      <WarehousePicker warehouses={visibleWarehouses} value={warehouseId} onChange={chooseWarehouse} />

      <OfferingsTab warehouseId={warehouseId} canManage={canManage} pictures={lookups.pictures} categories={lookups.categories} attempt={attempt} setAttempt={setAttempt} adding={adding} setAdding={setAdding} />
    </>
  );
}
