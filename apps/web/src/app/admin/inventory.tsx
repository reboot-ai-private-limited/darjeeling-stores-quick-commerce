"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { adminFetch, type AdminSession } from "./session-client";

// ─── Types ───────────────────────────────────────────────────────────────────

type WarehouseOption = { id: string; name: string; code: string };

type Offering = {
  id: string;
  productId: string;
  productTitle: string;
  variantId: string;
  sku: string;
  mrp: number;
  sellingPrice: number;
  isActive: boolean;
};

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
  warehouseId: string;
  sku: string;
  productTitle: string;
  onHand: number;
  reserved: number;
  available: number;
};

type StockMovement = {
  id: string;
  sku: string;
  type: string;
  qty: number;
  note: string;
  createdAt: string;
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
  return `₹${n.toFixed(2)}`;
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
      <label htmlFor="wh-picker" style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>Warehouse</label>
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

  // Activate single
  const [activating, setActivating] = useState(false);
  const [aProductId, setAProductId] = useState("");
  const [aVariantId, setAVariantId] = useState("");
  const [aMrp, setAMrp] = useState("");
  const [aSellingPrice, setASellingPrice] = useState("");
  const [activateError, setActivateError] = useState("");

  // Bulk activate
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkMrp, setBulkMrp] = useState("");
  const [bulkSelling, setBulkSelling] = useState("");
  const [bulkError, setBulkError] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

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

  async function activate(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setActivateError("");
    try {
      await api("warehouse-products", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ warehouseId, productId: aProductId.trim(), variantId: aVariantId.trim() || undefined, mrp: parseFloat(aMrp), sellingPrice: parseFloat(aSellingPrice) }),
      });
      setActivating(false); setAProductId(""); setAVariantId(""); setAMrp(""); setASellingPrice("");
      setNotice("Product activated in warehouse."); setAttempt((v) => v + 1);
    } catch (err) {
      setActivateError(err instanceof Error ? err.message : "Could not activate.");
    } finally {
      setBusy(false);
    }
  }

  async function bulkActivate(e: FormEvent) {
    e.preventDefault();
    setBulkBusy(true); setBulkError("");
    try {
      const lines = bulkText.split(/[\n,]+/).map((l) => l.trim()).filter(Boolean);
      const items = lines.map((id) => ({ productId: id, mrp: parseFloat(bulkMrp), sellingPrice: parseFloat(bulkSelling) }));
      await api("warehouse-products/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ warehouseId, items }),
      });
      setBulkOpen(false); setBulkText(""); setBulkMrp(""); setBulkSelling("");
      setNotice(`${items.length} products activated.`); setAttempt((v) => v + 1);
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Bulk activation failed.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function saveEdit(offeringId: string) {
    setBusy(true); setEditError("");
    try {
      await api(`warehouse-products/${offeringId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ mrp: parseFloat(editMrp), sellingPrice: parseFloat(editSelling), isActive: editActive }),
      });
      setEditingId(null); setNotice("Offering updated."); setAttempt((v) => v + 1);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(o: Offering) {
    setEditingId(o.id); setEditMrp(String(o.mrp)); setEditSelling(String(o.sellingPrice)); setEditActive(o.isActive); setEditError("");
  }

  return (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        {notice && <p role="status" style={{ color: "#137333", margin: 0, fontSize: 12 }}>{notice}</p>}
        {error && <p role="alert" className="admin-role-error" style={{ margin: 0 }}>{error}</p>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="admin-text-button" disabled={loading || busy} onClick={() => setAttempt((v) => v + 1)}>Reload</button>
          {canManage && <>
            <button className="admin-role-button" style={{ padding: "8px 14px", fontSize: 12 }} onClick={() => { setActivating(!activating); setBulkOpen(false); }}>Activate product</button>
            <button style={{ border: "1px solid #bacbbd", borderRadius: 6, padding: "8px 14px", background: "#fff", cursor: "pointer", fontSize: 12 }} onClick={() => { setBulkOpen(!bulkOpen); setActivating(false); }}>Bulk activate</button>
          </>}
        </div>
      </div>

      {activating && (
        <form className="admin-panel admin-role-form" onSubmit={activate} style={{ marginBottom: 16 }}>
          <h2>Activate product in warehouse</h2>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", maxWidth: 600 }}>
            <label style={{ flex: 1, minWidth: 160, fontSize: 12 }}>Product ID *
              <input required value={aProductId} disabled={busy} onChange={(e) => setAProductId(e.target.value)}
                style={{ display: "block", marginTop: 5, width: "100%", padding: "8px 10px", border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }} />
            </label>
            <label style={{ flex: 1, minWidth: 160, fontSize: 12 }}>Variant ID (optional)
              <input value={aVariantId} disabled={busy} onChange={(e) => setAVariantId(e.target.value)}
                style={{ display: "block", marginTop: 5, width: "100%", padding: "8px 10px", border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }} />
            </label>
            <label style={{ width: 120, fontSize: 12 }}>MRP (₹) *
              <input type="number" min="0" step="0.01" required value={aMrp} disabled={busy} onChange={(e) => setAMrp(e.target.value)}
                style={{ display: "block", marginTop: 5, width: "100%", padding: "8px 10px", border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }} />
            </label>
            <label style={{ width: 140, fontSize: 12 }}>Selling price (₹) *
              <input type="number" min="0" step="0.01" required value={aSellingPrice} disabled={busy} onChange={(e) => setASellingPrice(e.target.value)}
                style={{ display: "block", marginTop: 5, width: "100%", padding: "8px 10px", border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }} />
            </label>
          </div>
          {activateError && <p role="alert" className="admin-role-error" style={{ marginTop: 8 }}>{activateError}</p>}
          <div className="admin-role-actions" style={{ marginTop: 14, padding: 0 }}>
            <button className="admin-role-button" type="submit" disabled={busy}>{busy ? "Activating…" : "Activate"}</button>
            <button type="button" disabled={busy} onClick={() => setActivating(false)}>Cancel</button>
          </div>
        </form>
      )}

      {bulkOpen && (
        <form className="admin-panel admin-role-form" onSubmit={bulkActivate} style={{ marginBottom: 16 }}>
          <h2>Bulk activate products</h2>
          <p style={{ fontSize: 12, color: "var(--admin-muted)" }}>Enter one product ID per line (or comma-separated). All products will use the same MRP and selling price.</p>
          <div style={{ display: "grid", gap: 12, maxWidth: 500 }}>
            <label htmlFor="bulk-ids" style={{ fontSize: 12 }}>Product IDs *
              <textarea id="bulk-ids" required value={bulkText} disabled={bulkBusy} onChange={(e) => setBulkText(e.target.value)}
                style={{ display: "block", marginTop: 5, width: "100%", minHeight: 100, padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit", resize: "vertical" }} />
            </label>
            <div style={{ display: "flex", gap: 12 }}>
              <label style={{ flex: 1, fontSize: 12 }}>MRP (₹) *
                <input type="number" min="0" step="0.01" required value={bulkMrp} disabled={bulkBusy} onChange={(e) => setBulkMrp(e.target.value)}
                  style={{ display: "block", marginTop: 5, width: "100%", padding: "8px 10px", border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }} />
              </label>
              <label style={{ flex: 1, fontSize: 12 }}>Selling price (₹) *
                <input type="number" min="0" step="0.01" required value={bulkSelling} disabled={bulkBusy} onChange={(e) => setBulkSelling(e.target.value)}
                  style={{ display: "block", marginTop: 5, width: "100%", padding: "8px 10px", border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }} />
              </label>
            </div>
          </div>
          {bulkError && <p role="alert" className="admin-role-error" style={{ marginTop: 8 }}>{bulkError}</p>}
          <div className="admin-role-actions" style={{ marginTop: 14, padding: 0 }}>
            <button className="admin-role-button" type="submit" disabled={bulkBusy}>{bulkBusy ? "Activating…" : "Bulk activate"}</button>
            <button type="button" disabled={bulkBusy} onClick={() => setBulkOpen(false)}>Cancel</button>
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
                  <th>SKU</th>
                  <th>MRP</th>
                  <th>Selling price</th>
                  <th>Status</th>
                  {canManage && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {offerings.map((o) => (
                  <tr key={o.id}>
                    <td style={{ fontWeight: 500 }}>{o.productTitle}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--admin-muted)" }}>{o.sku}</td>
                    <td>{editingId === o.id ? (
                      <input type="number" min="0" step="0.01" value={editMrp} onChange={(e) => setEditMrp(e.target.value)}
                        style={{ width: 90, padding: "5px 8px", border: "1px solid #bacbbd", borderRadius: 4, font: "inherit", fontSize: 12 }} />
                    ) : fmt(o.mrp)}</td>
                    <td>{editingId === o.id ? (
                      <input type="number" min="0" step="0.01" value={editSelling} onChange={(e) => setEditSelling(e.target.value)}
                        style={{ width: 90, padding: "5px 8px", border: "1px solid #bacbbd", borderRadius: 4, font: "inherit", fontSize: 12 }} />
                    ) : fmt(o.sellingPrice)}</td>
                    <td>
                      {editingId === o.id ? (
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                          <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
                          Active
                        </label>
                      ) : (
                        <span className={`admin-badge ${o.isActive ? "admin-badge-active" : "admin-badge-disabled"}`}>{o.isActive ? "Active" : "Inactive"}</span>
                      )}
                    </td>
                    {canManage && (
                      <td>
                        <div className="admin-role-actions" style={{ padding: 0, gap: 6 }}>
                          {editingId === o.id ? (
                            <>
                              {editError && <span style={{ color: "#a73535", fontSize: 11 }}>{editError}</span>}
                              <button disabled={busy} onClick={() => saveEdit(o.id)} style={{ border: "1px solid #bacbbd", borderRadius: 6, padding: "4px 10px", background: "#fff", cursor: "pointer", fontSize: 12, color: "var(--admin-accent)" }}>{busy ? "…" : "Save"}</button>
                              <button disabled={busy} onClick={() => setEditingId(null)} style={{ border: "1px solid #bacbbd", borderRadius: 6, padding: "4px 10px", background: "#fff", cursor: "pointer", fontSize: 12 }}>Cancel</button>
                            </>
                          ) : (
                            <button onClick={() => startEdit(o)} style={{ border: "1px solid #bacbbd", borderRadius: 6, padding: "4px 10px", background: "#fff", cursor: "pointer", fontSize: 12 }}>Edit</button>
                          )}
                        </div>
                      </td>
                    )}
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
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{e.sku}</td>
                  <td>{e.oldMrp != null ? fmt(e.oldMrp) : "—"}</td>
                  <td>{e.newMrp != null ? fmt(e.newMrp) : "—"}</td>
                  <td>{e.oldSellingPrice != null ? fmt(e.oldSellingPrice) : "—"}</td>
                  <td>{e.newSellingPrice != null ? fmt(e.newSellingPrice) : "—"}</td>
                  <td style={{ color: "var(--admin-muted)" }}>{e.changedBy}</td>
                  <td style={{ color: "var(--admin-muted)", fontSize: 12 }}>{fmtDate(e.changedAt)}</td>
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

  // Adjust form
  const [adjSku, setAdjSku] = useState("");
  const [adjQty, setAdjQty] = useState("");
  const [adjType, setAdjType] = useState("shrinkage");
  const [adjReason, setAdjReason] = useState("");
  const [adjError, setAdjError] = useState("");

  // Count form: array of {sku, counted}
  const [countRows, setCountRows] = useState<{ sku: string; counted: string }[]>([{ sku: "", counted: "" }]);
  const [countError, setCountError] = useState("");

  useEffect(() => {
    if (!warehouseId || subTab === "adjust" || subTab === "count") return;
    const controller = new AbortController();
    setLoading(true); setError("");
    const path = subTab === "levels" ? `stock/levels?warehouseId=${warehouseId}` : `stock/movements?warehouseId=${warehouseId}`;
    if (subTab === "levels") {
      api<{ data: StockLevel[] }>(path, { signal: controller.signal })
        .then((body) => { if (!controller.signal.aborted) setLevels(body.data); })
        .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Stock levels could not be loaded."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    } else {
      api<{ data: StockMovement[] }>(path, { signal: controller.signal })
        .then((body) => { if (!controller.signal.aborted) setMovements(body.data); })
        .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Movements could not be loaded."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }
    return () => controller.abort();
  }, [warehouseId, subTab, attempt]);

  async function submitAdjust(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setAdjError(""); setNotice("");
    try {
      await api("stock/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ warehouseId, sku: adjSku.trim(), qty: parseInt(adjQty, 10), type: adjType, reason: adjReason }),
      });
      setAdjSku(""); setAdjQty(""); setAdjReason("");
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
      const counts = countRows.filter((r) => r.sku.trim()).map((r) => ({ sku: r.sku.trim(), counted: parseInt(r.counted, 10) || 0 }));
      await api("stock/count", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ warehouseId, counts }),
      });
      setCountRows([{ sku: "", counted: "" }]);
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

  return (
    <>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {subTabs.map((t) => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            style={{ padding: "7px 14px", border: "1px solid #bacbbd", borderRadius: 6, background: subTab === t.key ? "#eef3ee" : "#fff", color: subTab === t.key ? "var(--admin-accent)" : "var(--admin-text)", fontWeight: subTab === t.key ? 600 : 400, cursor: "pointer", fontSize: 12 }}>
            {t.label}
          </button>
        ))}
        {(subTab === "levels" || subTab === "movements") && (
          <button className="admin-text-button" style={{ marginLeft: "auto" }} disabled={loading} onClick={() => setAttempt((v) => v + 1)}>Reload</button>
        )}
      </div>

      {notice && <p role="status" style={{ color: "#137333", marginBottom: 12, fontSize: 12 }}>{notice}</p>}

      {subTab === "levels" && (
        <section className="admin-panel" aria-labelledby="stock-levels-title">
          <div className="admin-panel-toolbar"><h2 id="stock-levels-title">Stock levels</h2><span>{levels.length} SKUs</span></div>
          {!warehouseId ? <p className="admin-roles-message">Select a warehouse above.</p>
            : loading ? <p className="admin-roles-message" role="status">Loading…</p>
            : error ? <p className="admin-roles-message" role="alert">{error}</p>
            : levels.length === 0 ? <p className="admin-roles-message">No stock data for this warehouse.</p>
            : (
              <div style={{ overflowX: "auto" }}>
                <table className="admin-stock-table">
                  <thead><tr><th>Product</th><th>SKU</th><th>On hand</th><th>Reserved</th><th>Available</th></tr></thead>
                  <tbody>
                    {levels.map((s, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 500 }}>{s.productTitle}</td>
                        <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--admin-muted)" }}>{s.sku}</td>
                        <td>{s.onHand}</td>
                        <td style={{ color: s.reserved > 0 ? "#b06000" : "inherit" }}>{s.reserved}</td>
                        <td style={{ fontWeight: 600, color: s.available <= 0 ? "#c5221f" : "#137333" }}>{s.available}</td>
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
                  <thead><tr><th>SKU</th><th>Type</th><th>Qty</th><th>Note</th><th>When</th></tr></thead>
                  <tbody>
                    {movements.map((m) => (
                      <tr key={m.id}>
                        <td style={{ fontFamily: "monospace", fontSize: 12 }}>{m.sku}</td>
                        <td><span className="admin-badge" style={{ background: "#eef3ee", color: "#285c46" }}>{m.type}</span></td>
                        <td style={{ fontWeight: 600, color: m.qty < 0 ? "#c5221f" : "#137333" }}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                        <td style={{ color: "var(--admin-muted)", fontSize: 12 }}>{m.note || "—"}</td>
                        <td style={{ color: "var(--admin-muted)", fontSize: 12 }}>{fmtDate(m.createdAt)}</td>
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
            <label htmlFor="adj-sku" style={{ fontSize: 12 }}>SKU *
              <input id="adj-sku" required value={adjSku} disabled={busy} onChange={(e) => setAdjSku(e.target.value)}
                style={{ display: "block", marginTop: 5, width: "100%", padding: "8px 10px", border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }} />
            </label>
            <label htmlFor="adj-type" style={{ fontSize: 12 }}>Adjustment type *
              <select id="adj-type" value={adjType} disabled={busy} onChange={(e) => setAdjType(e.target.value)}
                style={{ display: "block", marginTop: 5, width: "100%", padding: "8px 10px", border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }}>
                <option value="shrinkage">Shrinkage</option>
                <option value="damaged">Damaged goods</option>
                <option value="restock">Manual restock</option>
              </select>
            </label>
            <label htmlFor="adj-qty" style={{ fontSize: 12 }}>Quantity (negative = reduction) *
              <input id="adj-qty" type="number" required value={adjQty} disabled={busy} onChange={(e) => setAdjQty(e.target.value)}
                style={{ display: "block", marginTop: 5, width: "100%", padding: "8px 10px", border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }} />
            </label>
            <label htmlFor="adj-reason" style={{ fontSize: 12 }}>Reason / notes
              <textarea id="adj-reason" value={adjReason} disabled={busy} onChange={(e) => setAdjReason(e.target.value)} maxLength={500}
                style={{ display: "block", marginTop: 5, width: "100%", minHeight: 70, padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit", resize: "vertical" }} />
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
          <p style={{ fontSize: 12, color: "var(--admin-muted)" }}>Enter the physically counted quantity for each SKU. The system will reconcile against on-hand stock.</p>
          <div style={{ display: "grid", gap: 8, maxWidth: 480 }}>
            {countRows.map((row, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input placeholder="SKU" value={row.sku} disabled={busy}
                  onChange={(e) => { const r = [...countRows]; r[i] = { ...r[i]!, sku: e.target.value }; setCountRows(r); }}
                  style={{ flex: 2, padding: "8px 10px", border: "1px solid #bacbbd", borderRadius: 6, font: "inherit", fontSize: 12 }} />
                <input type="number" placeholder="Counted qty" value={row.counted} disabled={busy}
                  onChange={(e) => { const r = [...countRows]; r[i] = { ...r[i]!, counted: e.target.value }; setCountRows(r); }}
                  style={{ flex: 1, padding: "8px 10px", border: "1px solid #bacbbd", borderRadius: 6, font: "inherit", fontSize: 12 }} />
                {countRows.length > 1 && (
                  <button type="button" onClick={() => setCountRows((r) => r.filter((_, j) => j !== i))}
                    style={{ border: "1px solid #bacbbd", borderRadius: 6, padding: "7px 10px", background: "#fff", cursor: "pointer", fontSize: 12, color: "#a73535" }}>✕</button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setCountRows((r) => [...r, { sku: "", counted: "" }])}
              style={{ border: "1px solid #bacbbd", borderRadius: 6, padding: "7px 14px", background: "#fff", cursor: "pointer", fontSize: 12, alignSelf: "flex-start", color: "var(--admin-accent)" }}>
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
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--admin-muted)" }}>Upload a CSV to preview and commit bulk stock / price changes.</p>
        </div>
      </div>

      {notice && <p role="status" style={{ color: "#137333", marginBottom: 12 }}>{notice}</p>}
      {error && <p role="alert" className="admin-role-error" style={{ marginBottom: 12 }}>{error}</p>}

      {!preview ? (
        <section className="admin-panel" aria-labelledby="import-upload-title" style={{ maxWidth: 480 }}>
          <div className="admin-panel-toolbar"><h2 id="import-upload-title">Upload CSV</h2></div>
          <div style={{ padding: 24 }}>
            {!warehouseId && <p style={{ fontSize: 12, color: "#b06000", marginBottom: 12 }}>Select a warehouse before uploading.</p>}
            <label style={{ display: "block", cursor: "pointer" }}>
              <span className="admin-role-button" style={{ display: "inline-block", padding: "10px 18px", opacity: (loading || !warehouseId) ? 0.6 : 1 }}>
                {loading ? "Parsing CSV…" : "Choose CSV file"}
              </span>
              <input ref={fileRef} type="file" accept=".csv,text/csv" disabled={loading || !warehouseId} onChange={handleFile} style={{ display: "none" }} />
            </label>
            <p style={{ fontSize: 11, color: "var(--admin-muted)", marginTop: 10 }}>The file will be validated first. No changes are made until you confirm.</p>
          </div>
        </section>
      ) : (
        <section className="admin-panel" aria-labelledby="import-preview-title">
          <div className="admin-panel-toolbar">
            <h2 id="import-preview-title">Preview — {validCount} valid, {invalidCount} invalid</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="admin-text-button" onClick={() => { setPreview(null); setImportId(null); }}>Upload different file</button>
              {importId && validCount > 0 && (
                <button className="admin-role-button" style={{ padding: "6px 14px", fontSize: 12 }} disabled={committing || invalidCount > 0}
                  onClick={commit}>{committing ? "Committing…" : "Commit import"}</button>
              )}
            </div>
          </div>
          {invalidCount > 0 && (
            <p style={{ padding: "10px 20px", fontSize: 12, color: "#a73535", borderBottom: "1px solid var(--admin-border)" }}>
              Fix {invalidCount} invalid row{invalidCount !== 1 ? "s" : ""} before committing.
            </p>
          )}
          <div className="admin-import-preview">
            <div className="admin-import-row" style={{ fontWeight: 600, fontSize: 11, color: "var(--admin-muted)", background: "#fafbf9", borderBottom: "1px solid var(--admin-border)" }}>
              <span>SKU</span><span>Field</span><span>Value</span><span>Status</span>
            </div>
            {preview.map((row, i) => (
              <div key={i} className={`admin-import-row ${row.valid ? "is-valid" : "is-invalid"}`}>
                <span style={{ fontFamily: "monospace", fontSize: 12 }}>{row.sku}</span>
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
