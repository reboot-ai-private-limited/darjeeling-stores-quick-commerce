"use client";

import { Fragment, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { adminFetch, type AdminSession } from "./session-client";

// ─── Types ───────────────────────────────────────────────────────────────────

type WarehouseOption = { id: string; name: string; code: string };

type OfferingVariant = { variantId: string; label: string; price: number; mrp: number; stock: number | null; isActive: boolean };
type Offering = { id: string; rev: number; productId: string; status: string; stockGrams: number | null; product: { name: string; type: string; stockMode: string }; variants: OfferingVariant[] };
const toPaise = (rupees: string) => Math.round(parseFloat(rupees) * 100);

type PriceEntry = {
  id: string;
  sku: string;
  oldMrp: number | null;
  newMrp: number | null;
  oldSellingPrice: number | null;
  newSellingPrice: number | null;
  changedAt: string;
  changedBy: string;
};

type StockLevel = {
  warehouseId: string; productId: string; name: string; variantId: string | null; variantLabel: string | null;
  unit: "units" | "grams"; stock: number; isLow?: boolean;
};

type StockMovement = {
  id: string; productId: string; variantId: string | null; mode: "grams" | "units";
  delta: number; balanceAfter: number; reason: string; note: string | null; createdAt: string;
};

type ImportPreviewRow = {
  sku: string;
  field: string;
  value: string;
  valid: boolean;
  error?: string;
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

function OfferingsTab({ warehouseId, canManage }: { warehouseId: string; canManage: boolean }) {
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cursors, setCursors] = useState<string[]>([""]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  // Add products (one panel: pick products, set price + stock, save once)
  type Vals = { mrp: string; price: string; stock: string };
  const [adding, setAdding] = useState(false);
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

  const cursor = cursors.at(-1)!;

  useEffect(() => {
    if (!warehouseId) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams({ limit: "25", ...(cursor && { cursor }) });
    api<{ data: Offering[]; meta: { nextCursor: string | null } }>(`warehouses/${warehouseId}/products?${params}`, { signal: controller.signal })
      .then((body) => { if (!controller.signal.aborted) { setOfferings(body.data); setNextCursor(body.meta.nextCursor); } })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Offerings could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [warehouseId, cursor, attempt]);

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
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        {notice && <p role="status" style={{ color: "#137333", margin: 0, fontSize: 14 }}>{notice}</p>}
        {error && <p role="alert" className="admin-role-error" style={{ margin: 0 }}>{error}</p>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="admin-text-button" disabled={loading || busy} onClick={() => setAttempt((v) => v + 1)}>Reload</button>
          {canManage && (
            <button className="admin-role-button" style={{ padding: "8px 14px", fontSize: 14 }} onClick={() => setAdding(!adding)}>{adding ? "Close" : "+ Add products"}</button>
          )}
        </div>
      </div>

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
                          <td colSpan={p.stockMode === "pooled_weight" && sel[p.id] ? 3 : 4} style={{ fontWeight: 600 }}>{p.name}{p.stockMode === "pooled_weight" && <small style={{ fontWeight: 400, color: "var(--admin-muted)" }}> — sold by weight</small>}</td>
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
        <div className="admin-panel-toolbar">
          <h2 id="offerings-title">Offerings</h2>
          <span>{loading ? "Loading…" : `${offerings.length} shown`}</span>
        </div>
        {!warehouseId ? (
          <p className="admin-roles-message">Select a warehouse above to see its offerings.</p>
        ) : loading ? (
          <p className="admin-roles-message" role="status">Loading offerings…</p>
        ) : offerings.length === 0 ? (
          <p className="admin-roles-message">No products are activated for this warehouse yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="admin-stock-table">
              <thead>
                <tr>
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
                    <tr key={key}>
                      <td style={{ fontWeight: 500 }}>{o.product.name}</td>
                      <td style={{ fontSize: 14, color: "var(--admin-muted)" }}>{v.label}</td>
                      <td>{editing ? <input type="number" min="0" step="0.01" value={editMrp} onChange={(e) => setEditMrp(e.target.value)} style={small} /> : fmt(v.mrp)}</td>
                      <td>{editing ? <input type="number" min="0" step="0.01" value={editSelling} onChange={(e) => setEditSelling(e.target.value)} style={small} /> : fmt(v.price)}</td>
                      <td>{v.stock ?? "—"}</td>
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
                              <button onClick={() => startEdit(o, v)} style={{ border: "1px solid #cbc5ba", borderRadius: 6, padding: "4px 10px", background: "#fff", cursor: "pointer", fontSize: 14 }}>Edit</button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
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

// ─── Price History Tab ────────────────────────────────────────────────────────

function PriceHistoryTab({ warehouseId }: { warehouseId: string }) {
  const [entries, setEntries] = useState<PriceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cursors, setCursors] = useState<string[]>([""]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cursor = cursors.at(-1)!;

  useEffect(() => {
    if (!warehouseId) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams({ warehouseId, limit: "25", ...(cursor && { cursor }) });
    api<{ data: PriceEntry[]; meta: { nextCursor: string | null } }>(`price-history?${params}`, { signal: controller.signal })
      .then((body) => { if (!controller.signal.aborted) { setEntries(body.data); setNextCursor(body.meta.nextCursor); } })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "History could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [warehouseId, cursor, attempt]);

  return (
    <section className="admin-panel" aria-labelledby="price-hist-title">
      <div className="admin-panel-toolbar">
        <h2 id="price-hist-title">Price change audit log</h2>
        <button className="admin-text-button" disabled={loading} onClick={() => setAttempt((v) => v + 1)}>Reload</button>
      </div>
      {!warehouseId ? (
        <p className="admin-roles-message">Select a warehouse above.</p>
      ) : loading ? (
        <p className="admin-roles-message" role="status">Loading…</p>
      ) : error ? (
        <p className="admin-roles-message" role="alert">{error}</p>
      ) : entries.length === 0 ? (
        <p className="admin-roles-message">No price changes recorded.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="admin-stock-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Old MRP</th>
                <th>New MRP</th>
                <th>Old selling</th>
                <th>New selling</th>
                <th>Changed by</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td style={{ fontFamily: "monospace", fontSize: 14 }}>{e.sku}</td>
                  <td>{e.oldMrp != null ? fmt(e.oldMrp) : "—"}</td>
                  <td>{e.newMrp != null ? fmt(e.newMrp) : "—"}</td>
                  <td>{e.oldSellingPrice != null ? fmt(e.oldSellingPrice) : "—"}</td>
                  <td>{e.newSellingPrice != null ? fmt(e.newSellingPrice) : "—"}</td>
                  <td style={{ color: "var(--admin-muted)" }}>{e.changedBy}</td>
                  <td style={{ color: "var(--admin-muted)", fontSize: 14 }}>{fmtDate(e.changedAt)}</td>
                </tr>
              ))}
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
  );
}

// ─── Stock Tab ────────────────────────────────────────────────────────────────

function StockTab({ warehouseId, canManage }: { warehouseId: string; canManage: boolean }) {
  const [levels, setLevels] = useState<StockLevel[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [subTab, setSubTab] = useState<"levels" | "movements" | "adjust" | "count">("levels");
  const [busy, setBusy] = useState(false);

  // Adjust form. "item" is "productId|variantId" so nobody types SKUs or IDs.
  const [adjItem, setAdjItem] = useState("");
  const [adjQty, setAdjQty] = useState("");
  const [adjReason, setAdjReason] = useState("purchase");
  const [adjNote, setAdjNote] = useState("");
  const [adjError, setAdjError] = useState("");

  // Count form
  const [countRows, setCountRows] = useState<{ item: string; counted: string }[]>([{ item: "", counted: "" }]);
  const [countError, setCountError] = useState("");

  const itemKey = (l: { productId: string; variantId: string | null }) => `${l.productId}|${l.variantId ?? ""}`;
  const itemName = (l: { name: string; variantLabel: string | null }) => (l.variantLabel ? `${l.name} — ${l.variantLabel}` : l.name);
  const byKey = new Map(levels.map((l) => [itemKey(l), l]));
  const nameOf = (m: { productId: string; variantId: string | null }) => { const l = byKey.get(itemKey(m)); return l ? itemName(l) : m.productId; };

  useEffect(() => {
    if (!warehouseId) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    const lv = api<{ data: StockLevel[] }>(`stock/levels?warehouseId=${warehouseId}&limit=100`, { signal: controller.signal })
      .then((body) => { if (!controller.signal.aborted) setLevels(body.data); });
    const mv = subTab === "movements"
      ? api<{ data: StockMovement[] }>(`stock/movements?warehouseId=${warehouseId}&limit=100`, { signal: controller.signal })
        .then((body) => { if (!controller.signal.aborted) setMovements(body.data); })
      : Promise.resolve();
    Promise.all([lv, mv])
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Stock could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [warehouseId, subTab, attempt]);

  function split(key: string) { const [productId, variantId] = key.split("|"); return { productId: productId!, variantId: variantId || null }; }

  async function submitAdjust(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setAdjError(""); setNotice("");
    try {
      const delta = parseInt(adjQty, 10);
      if (!Number.isInteger(delta) || delta === 0) throw new Error("Enter a quantity other than zero.");
      await api("stock/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ warehouseId, ...split(adjItem), delta, reason: adjReason, note: adjNote.trim() || null }),
      });
      setAdjItem(""); setAdjQty(""); setAdjNote("");
      setNotice("Stock adjustment recorded."); setSubTab("levels"); setAttempt((v) => v + 1);
    } catch (err) {
      setAdjError(err instanceof Error ? err.message : "Adjustment failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCount(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setCountError(""); setNotice("");
    try {
      const counts = countRows.filter((r) => r.item).map((r) => ({ ...split(r.item), counted: Math.max(0, parseInt(r.counted, 10) || 0) }));
      if (counts.length === 0) throw new Error("Pick at least one product to count.");
      await api("stock/count", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ warehouseId, counts }),
      });
      setCountRows([{ item: "", counted: "" }]);
      setNotice("Cycle count submitted."); setSubTab("levels"); setAttempt((v) => v + 1);
    } catch (err) {
      setCountError(err instanceof Error ? err.message : "Count submission failed.");
    } finally {
      setBusy(false);
    }
  }

  const subTabs = [
    { key: "levels", label: "Stock levels" },
    { key: "movements", label: "Movements" },
    ...(canManage ? [{ key: "adjust", label: "Adjustment" }, { key: "count", label: "Cycle count" }] : []),
  ] as { key: typeof subTab; label: string }[];

  const itemOptions = levels.map((l) => <option key={itemKey(l)} value={itemKey(l)}>{itemName(l)} (now {l.stock} {l.unit})</option>);
  const selected = byKey.get(adjItem);

  return (
    <>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {subTabs.map((t) => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            style={{ padding: "7px 14px", border: "1px solid #cbc5ba", borderRadius: 6, background: subTab === t.key ? "#f3f1ee" : "#fff", color: subTab === t.key ? "var(--admin-accent)" : "var(--admin-text)", cursor: "pointer", fontSize: 14 }}>
            {t.label}
          </button>
        ))}
        {(subTab === "levels" || subTab === "movements") && (
          <button className="admin-text-button" style={{ marginLeft: "auto" }} disabled={loading} onClick={() => setAttempt((v) => v + 1)}>Reload</button>
        )}
      </div>

      {notice && <p role="status" style={{ color: "#137333", marginBottom: 12, fontSize: 14 }}>{notice}</p>}

      {subTab === "levels" && (
        <section className="admin-panel" aria-labelledby="stock-levels-title">
          <div className="admin-panel-toolbar"><h2 id="stock-levels-title">Stock levels</h2><span>{levels.length} items</span></div>
          {!warehouseId ? <p className="admin-roles-message">Select a warehouse above.</p>
            : loading ? <p className="admin-roles-message" role="status">Loading…</p>
            : error ? <p className="admin-roles-message" role="alert">{error}</p>
            : levels.length === 0 ? <p className="admin-roles-message">No stock data. Activate products in this warehouse first (Offerings tab).</p>
            : (
              <div style={{ overflowX: "auto" }}>
                <table className="admin-stock-table">
                  <thead><tr><th>Product</th><th>Variant</th><th>In stock</th><th>Status</th></tr></thead>
                  <tbody>
                    {levels.map((l) => (
                      <tr key={itemKey(l)}>
                        <td style={{ fontWeight: 500 }}>{l.name}</td>
                        <td style={{ fontSize: 14, color: "var(--admin-muted)" }}>{l.variantLabel ?? "Pooled weight"}</td>
                        <td style={{ fontWeight: 600 }}>{l.stock} {l.unit}</td>
                        <td>{l.stock <= 0 ? <span className="admin-badge admin-badge-disabled">Out of stock</span> : l.isLow ? <span className="admin-badge admin-badge-paused">Low</span> : <span className="admin-badge admin-badge-active">OK</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </section>
      )}

      {subTab === "movements" && (
        <section className="admin-panel" aria-labelledby="movements-title">
          <div className="admin-panel-toolbar"><h2 id="movements-title">Stock movements</h2></div>
          {!warehouseId ? <p className="admin-roles-message">Select a warehouse above.</p>
            : loading ? <p className="admin-roles-message" role="status">Loading…</p>
            : error ? <p className="admin-roles-message" role="alert">{error}</p>
            : movements.length === 0 ? <p className="admin-roles-message">No movements recorded.</p>
            : (
              <div style={{ overflowX: "auto" }}>
                <table className="admin-stock-table">
                  <thead><tr><th>Product</th><th>Reason</th><th>Change</th><th>Balance</th><th>Note</th><th>When</th></tr></thead>
                  <tbody>
                    {movements.map((m) => (
                      <tr key={m.id}>
                        <td style={{ fontWeight: 500 }}>{nameOf(m)}</td>
                        <td><span className="admin-badge" style={{ background: "#f3f1ee", color: "#c62828" }}>{m.reason}</span></td>
                        <td style={{ fontWeight: 600, color: m.delta < 0 ? "#c5221f" : "#137333" }}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                        <td>{m.balanceAfter}</td>
                        <td style={{ color: "var(--admin-muted)", fontSize: 14 }}>{m.note || "—"}</td>
                        <td style={{ color: "var(--admin-muted)", fontSize: 14 }}>{fmtDate(m.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </section>
      )}

      {subTab === "adjust" && (
        <form className="admin-panel admin-role-form" onSubmit={submitAdjust} style={{ maxWidth: 480 }}>
          <h2>Manual stock adjustment</h2>
          <div style={{ display: "grid", gap: 12 }}>
            <label htmlFor="adj-item" style={{ fontSize: 14 }}>Product *
              <select id="adj-item" required value={adjItem} disabled={busy} onChange={(e) => setAdjItem(e.target.value)} style={{ display: "block", marginTop: 5, width: "100%", padding: "8px 10px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit" }}>
                <option value="">Select a product / variant</option>
                {itemOptions}
              </select>
            </label>
            <label htmlFor="adj-reason" style={{ fontSize: 14 }}>Reason *
              <select id="adj-reason" value={adjReason} disabled={busy} onChange={(e) => setAdjReason(e.target.value)} style={{ display: "block", marginTop: 5, width: "100%", padding: "8px 10px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit" }}>
                <option value="purchase">Purchase / new stock received</option>
                <option value="wastage">Wastage / damaged / expired</option>
                <option value="correction">Correction</option>
              </select>
            </label>
            <label htmlFor="adj-qty" style={{ fontSize: 14 }}>Quantity change{selected ? ` (${selected.unit})` : ""} — use a minus for a reduction *
              <input id="adj-qty" type="number" step="1" required value={adjQty} disabled={busy} onChange={(e) => setAdjQty(e.target.value)} style={{ display: "block", marginTop: 5, width: "100%", padding: "8px 10px", border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit" }} />
            </label>
            <label htmlFor="adj-note" style={{ fontSize: 14 }}>Note
              <textarea id="adj-note" value={adjNote} disabled={busy} onChange={(e) => setAdjNote(e.target.value)} maxLength={200}
                style={{ display: "block", marginTop: 5, width: "100%", minHeight: 70, padding: 10, border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit", resize: "vertical" }} />
            </label>
          </div>
          {adjError && <p role="alert" className="admin-role-error" style={{ marginTop: 10 }}>{adjError}</p>}
          <div className="admin-role-actions" style={{ marginTop: 16, padding: 0 }}>
            <button className="admin-role-button" type="submit" disabled={busy}>{busy ? "Submitting…" : "Record adjustment"}</button>
          </div>
        </form>
      )}

      {subTab === "count" && (
        <form className="admin-panel admin-role-form" onSubmit={submitCount}>
          <h2>Cycle count / physical audit</h2>
          <p style={{ fontSize: 14, color: "var(--admin-muted)" }}>Pick each product and enter the quantity you physically counted. The system sets stock to that number.</p>
          <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
            {countRows.map((row, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <select value={row.item} disabled={busy} style={{ flex: 2 }}
                  onChange={(e) => { const r = [...countRows]; r[i] = { ...r[i]!, item: e.target.value }; setCountRows(r); }}>
                  <option value="">Select a product / variant</option>
                  {itemOptions}
                </select>
                <input type="number" min="0" step="1" placeholder="Counted qty" value={row.counted} disabled={busy} style={{ flex: 1 }}
                  onChange={(e) => { const r = [...countRows]; r[i] = { ...r[i]!, counted: e.target.value }; setCountRows(r); }} />
                {countRows.length > 1 && (
                  <button type="button" onClick={() => setCountRows((r) => r.filter((_, j) => j !== i))}
                    style={{ border: "1px solid #cbc5ba", borderRadius: 6, padding: "7px 10px", background: "#fff", cursor: "pointer", fontSize: 14, color: "#a73535" }}>✕</button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setCountRows((r) => [...r, { item: "", counted: "" }])}
              style={{ border: "1px solid #cbc5ba", borderRadius: 6, padding: "7px 14px", background: "#fff", cursor: "pointer", fontSize: 14, alignSelf: "flex-start", color: "var(--admin-accent)" }}>
              + Add row
            </button>
          </div>
          {countError && <p role="alert" className="admin-role-error" style={{ marginTop: 10 }}>{countError}</p>}
          <div className="admin-role-actions" style={{ marginTop: 16, padding: 0 }}>
            <button className="admin-role-button" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit count"}</button>
          </div>
        </form>
      )}
    </>
  );
}

// ─── Import Tab ───────────────────────────────────────────────────────────────

function ImportTab({ warehouseId }: { warehouseId: string }) {
  const [preview, setPreview] = useState<ImportPreviewRow[] | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true); setError(""); setPreview(null); setImportId(null); setNotice("");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("warehouseId", warehouseId);
    try {
      const res = await adminFetch("/api/v1/admin/import/preview", { method: "POST", headers: { "X-CSRF-Token": "1" }, body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Preview failed.");
      setPreview(body.data.rows ?? body.data);
      setImportId(body.data.importId ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed.");
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function commit() {
    if (!importId) return;
    setCommitting(true); setError("");
    try {
      await api("import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ importId }),
      });
      setPreview(null); setImportId(null);
      setNotice("Import committed successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Commit failed.");
    } finally {
      setCommitting(false);
    }
  }

  const validCount = preview?.filter((r) => r.valid).length ?? 0;
  const invalidCount = preview?.filter((r) => !r.valid).length ?? 0;

  return (
    <>
      <div className="admin-heading" style={{ marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 20, margin: 0 }}>Bulk Import</h2>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--admin-muted)" }}>Upload a CSV to preview and commit bulk stock / price changes.</p>
        </div>
      </div>

      {notice && <p role="status" style={{ color: "#137333", marginBottom: 12 }}>{notice}</p>}
      {error && <p role="alert" className="admin-role-error" style={{ marginBottom: 12 }}>{error}</p>}

      {!preview ? (
        <section className="admin-panel" aria-labelledby="import-upload-title" style={{ maxWidth: 480 }}>
          <div className="admin-panel-toolbar"><h2 id="import-upload-title">Upload CSV</h2></div>
          <div style={{ padding: 24 }}>
            {!warehouseId && <p style={{ fontSize: 14, color: "#b06000", marginBottom: 12 }}>Select a warehouse before uploading.</p>}
            <label style={{ display: "block", cursor: "pointer" }}>
              <span className="admin-role-button" style={{ display: "inline-block", padding: "10px 18px", opacity: (loading || !warehouseId) ? 0.6 : 1 }}>
                {loading ? "Parsing CSV…" : "Choose CSV file"}
              </span>
              <input ref={fileRef} type="file" accept=".csv,text/csv" disabled={loading || !warehouseId} onChange={handleFile} style={{ display: "none" }} />
            </label>
            <p style={{ fontSize: 13, color: "var(--admin-muted)", marginTop: 10 }}>The file will be validated first. No changes are made until you confirm.</p>
          </div>
        </section>
      ) : (
        <section className="admin-panel" aria-labelledby="import-preview-title">
          <div className="admin-panel-toolbar">
            <h2 id="import-preview-title">Preview — {validCount} valid, {invalidCount} invalid</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="admin-text-button" onClick={() => { setPreview(null); setImportId(null); }}>Upload different file</button>
              {importId && validCount > 0 && (
                <button className="admin-role-button" style={{ padding: "6px 14px", fontSize: 14 }} disabled={committing || invalidCount > 0}
                  onClick={commit}>{committing ? "Committing…" : "Commit import"}</button>
              )}
            </div>
          </div>
          {invalidCount > 0 && (
            <p style={{ padding: "10px 20px", fontSize: 14, color: "#a73535", borderBottom: "1px solid var(--admin-border)" }}>
              Fix {invalidCount} invalid row{invalidCount !== 1 ? "s" : ""} before committing.
            </p>
          )}
          <div className="admin-import-preview">
            <div className="admin-import-row" style={{ fontWeight: 600, fontSize: 13, color: "var(--admin-muted)", background: "#fbfaf9", borderBottom: "1px solid var(--admin-border)" }}>
              <span>SKU</span><span>Field</span><span>Value</span><span>Status</span>
            </div>
            {preview.map((row, i) => (
              <div key={i} className={`admin-import-row ${row.valid ? "is-valid" : "is-invalid"}`}>
                <span style={{ fontFamily: "monospace", fontSize: 14 }}>{row.sku}</span>
                <span>{row.field}</span>
                <span>{row.value}</span>
                <span>{row.valid ? "✓ Valid" : `✗ ${row.error ?? "Invalid"}`}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ─── Root Inventory Component ─────────────────────────────────────────────────

type InventoryTab = "offerings" | "price-history" | "stock" | "import";

export default function Inventory({ session }: { session: AdminSession }) {
  const [tab, setTab] = useState<InventoryTab>("offerings");
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

  useEffect(() => {
    void api<{ data: WarehouseOption[] }>("warehouses").then((body) => {
      const whList = body.data;
      setWarehouses(whList);
      // Auto-select the first accessible warehouse
      if (whList.length > 0) {
        const accessible = session.user.scope.all
          ? whList
          : whList.filter((w) => session.user.scope.warehouseIds.includes(w.id));
        if (accessible.length > 0) setWarehouseId(accessible[0]!.id);
      }
    }).catch(() => {});
  }, [session]);

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
      <div className="admin-heading" style={{ marginBottom: 8 }}>
        <div>
          <h1>Offerings &amp; Inventory</h1>
          <p>Manage per-warehouse product activation, pricing, and stock.</p>
        </div>
      </div>

      <WarehousePicker warehouses={visibleWarehouses} value={warehouseId} onChange={setWarehouseId} />

      <div className="admin-tab-nav" role="tablist" aria-label="Inventory sections">
        {([
          { key: "offerings", label: "Offerings" },
          { key: "price-history", label: "Price history" },
          { key: "stock", label: "Stock" },
          { key: "import", label: "Import" },
        ] as { key: InventoryTab; label: string }[]).map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key}
            className={tab === t.key ? "is-active" : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "offerings" && <OfferingsTab warehouseId={warehouseId} canManage={canManage} />}
      {tab === "price-history" && <PriceHistoryTab warehouseId={warehouseId} />}
      {tab === "stock" && <StockTab warehouseId={warehouseId} canManage={canManage} />}
      {tab === "import" && canManage && <ImportTab warehouseId={warehouseId} />}
      {tab === "import" && !canManage && <p className="admin-roles-message">Import requires inventory:manage permission.</p>}
    </>
  );
}
