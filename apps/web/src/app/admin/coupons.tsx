"use client";

import { useState, type FormEvent } from "react";
import { api, Badge, can, dateTime, errorText, Field, Heading, inputStyle, json, money, Notice, rupeesToPaise, useWarehouses, useZones, usePolling } from "./admin-kit";
import type { AdminSession } from "./session-client";

type CouponType = "percent" | "flat" | "free_delivery";
type Coupon = {
  id: string; code: string; type: CouponType; value: number; maxDiscount: number | null; minOrder: number;
  perUserLimit: number | null; totalLimit: number | null; usedCount: number; firstOrderOnly: boolean;
  zoneIds: string[]; warehouseIds: string[]; startsAt: string | null; endsAt: string | null; isActive: boolean; description: string | null;
};
type Usage = { userId: string; customerName: string | null; orderGroupId: string; groupNo?: string; discountAmount: number; at: string };

type Draft = {
  code: string; type: CouponType; value: string; maxDiscount: string; minOrder: string; perUserLimit: string; totalLimit: string;
  firstOrderOnly: boolean; zoneIds: string[]; startsAt: string; endsAt: string; description: string; isActive: boolean;
};
const blank: Draft = { code: "", type: "percent", value: "", maxDiscount: "", minOrder: "", perUserLimit: "", totalLimit: "", firstOrderOnly: false, zoneIds: [], startsAt: "", endsAt: "", description: "", isActive: true };

/** ISO to the value a datetime-local input wants (local time). */
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const rupees = (paise: number | null) => (paise === null ? "" : String(paise / 100));
const intOrNull = (v: string) => (v.trim() === "" ? null : Math.floor(Number(v)));

const toDraft = (c: Coupon): Draft => ({
  code: c.code, type: c.type, value: c.type === "flat" ? rupees(c.value) : c.type === "percent" ? String(c.value) : "",
  maxDiscount: rupees(c.maxDiscount), minOrder: rupees(c.minOrder || null), perUserLimit: c.perUserLimit === null ? "" : String(c.perUserLimit),
  totalLimit: c.totalLimit === null ? "" : String(c.totalLimit), firstOrderOnly: c.firstOrderOnly, zoneIds: c.zoneIds,
  startsAt: toLocal(c.startsAt), endsAt: toLocal(c.endsAt), description: c.description ?? "", isActive: c.isActive,
});

function body(d: Draft) {
  const percent = d.type === "percent", flat = d.type === "flat";
  const value = percent ? Math.floor(Number(d.value)) : flat ? rupeesToPaise(Number(d.value)) : 0;
  if ((percent || flat) && !(value >= 1)) throw new Error(percent ? "Enter a percentage from 1 to 100." : "Enter the discount amount.");
  if (percent && value > 100) throw new Error("A percentage can't be more than 100.");
  return {
    code: d.code.trim().toUpperCase(), type: d.type, value,
    maxDiscount: percent && d.maxDiscount.trim() ? rupeesToPaise(Number(d.maxDiscount)) : null,
    minOrder: d.minOrder.trim() ? rupeesToPaise(Number(d.minOrder)) : 0,
    perUserLimit: intOrNull(d.perUserLimit), totalLimit: intOrNull(d.totalLimit), firstOrderOnly: d.firstOrderOnly,
    zoneIds: d.zoneIds, warehouseIds: [], startsAt: fromLocal(d.startsAt), endsAt: fromLocal(d.endsAt),
    isActive: d.isActive, description: d.description.trim() || null,
  };
}

const offer = (c: Coupon) => c.type === "percent" ? `${c.value}% off${c.maxDiscount ? ` (up to ${money(c.maxDiscount)})` : ""}` : c.type === "flat" ? `${money(c.value)} off` : "Free delivery";

function state(c: Coupon): { tone: "active" | "paused" | "inactive"; label: string } {
  const now = Date.now();
  if (!c.isActive) return { tone: "inactive", label: "Inactive" };
  if (c.endsAt && new Date(c.endsAt).getTime() < now) return { tone: "inactive", label: "Expired" };
  if (c.startsAt && new Date(c.startsAt).getTime() > now) return { tone: "paused", label: "Scheduled" };
  if (c.totalLimit !== null && c.usedCount >= c.totalLimit) return { tone: "paused", label: "Fully used" };
  return { tone: "active", label: "Live" };
}

export default function Coupons({ session }: { session: AdminSession }) {
  const canManage = can(session.user.permissions, "pricing:manage");
  const warehouses = useWarehouses();
  const zones = useZones(warehouses);
  const [filter, setFilter] = useState<"all" | "true" | "false">("all");
  const list = usePolling(() => api<{ data: Coupon[] }>(`coupons?limit=100${filter === "all" ? "" : `&isActive=${filter}`}`).then(r => r.data), 0, [filter]);
  const [editing, setEditing] = useState<Coupon | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [usageFor, setUsageFor] = useState<Coupon | null>(null);
  const [usage, setUsage] = useState<{ rows: Usage[]; total: number } | null>(null);

  const zoneName = (id: string) => zones.find(z => z.id === id)?.name ?? `Zone …${id.slice(-4)}`;
  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));

  function open(c: Coupon | "new") { setEditing(c); setDraft(c === "new" ? blank : toDraft(c)); setError(""); setNotice(""); setUsageFor(null); }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const payload = body(draft);
      if (editing === "new") await api("coupons", json("POST", payload));
      else if (editing) await api(`coupons/${editing.id}`, json("PUT", payload));
      setEditing(null); setNotice(editing === "new" ? "Coupon created." : "Coupon saved."); list.reload();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }

  async function deactivate(c: Coupon) {
    setBusy(true); setError("");
    try { await api(`coupons/${c.id}/deactivate`, json("POST")); setConfirmId(null); setNotice(`${c.code} is now inactive.`); list.reload(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }

  async function showUsage(c: Coupon) {
    setUsageFor(c); setUsage(null); setEditing(null); setError("");
    try {
      const r = await api<{ data: Usage[]; meta?: { totalDiscount?: number } }>(`coupons/${c.id}/usage?limit=100`);
      setUsage({ rows: r.data, total: r.meta?.totalDiscount ?? 0 });
    } catch (cause) { setError(errorText(cause)); }
  }

  const coupons = list.data ?? [];
  return (
    <>
      <Heading title="Coupons" subtitle="Discount codes customers can apply to their cart.">
        {canManage && <button className="admin-role-button" onClick={() => open("new")}>+ New coupon</button>}
      </Heading>
      {notice && <Notice kind="ok">{notice}</Notice>}
      {error && !editing && <Notice>{error}</Notice>}

      {editing && (
        <form className="admin-panel admin-role-form" onSubmit={save} style={{ marginBottom: 18, padding: 22 }}>
          <h2>{editing === "new" ? "New coupon" : `Edit ${editing.code}`}</h2>
          {error && <Notice>{error}</Notice>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16, alignItems: "start" }}>
            <Field label="Code" hint="3–20 letters, digits, - or _. Customers type this.">
              <input required maxLength={20} value={draft.code} onChange={e => set({ code: e.target.value.toUpperCase() })} placeholder="WELCOME50" style={{ ...inputStyle, textTransform: "uppercase" }} disabled={busy} />
            </Field>
            <Field label="Type">
              <select value={draft.type} onChange={e => set({ type: e.target.value as CouponType })} disabled={busy}>
                <option value="percent">Percentage off</option>
                <option value="flat">Flat amount off</option>
                <option value="free_delivery">Free delivery</option>
              </select>
            </Field>
            {draft.type !== "free_delivery" && (
              <Field label={draft.type === "percent" ? "Percent off (1–100)" : "Amount off (₹)"}>
                <input required type="number" min={draft.type === "percent" ? 1 : 0.01} max={draft.type === "percent" ? 100 : undefined} step={draft.type === "percent" ? 1 : 0.01} value={draft.value} onChange={e => set({ value: e.target.value })} disabled={busy} />
              </Field>
            )}
            {draft.type === "percent" && (
              <Field label="Maximum discount (₹)" hint="Optional cap, e.g. 15 for “10% up to ₹15”.">
                <input type="number" min="0" step="0.01" value={draft.maxDiscount} onChange={e => set({ maxDiscount: e.target.value })} disabled={busy} />
              </Field>
            )}
            <Field label="Minimum order (₹)" hint="Leave blank for no minimum.">
              <input type="number" min="0" step="0.01" value={draft.minOrder} onChange={e => set({ minOrder: e.target.value })} disabled={busy} />
            </Field>
            <Field label="Uses per customer" hint="Blank = unlimited.">
              <input type="number" min="1" step="1" value={draft.perUserLimit} onChange={e => set({ perUserLimit: e.target.value })} disabled={busy} />
            </Field>
            <Field label="Total uses" hint="Blank = unlimited.">
              <input type="number" min="1" step="1" value={draft.totalLimit} onChange={e => set({ totalLimit: e.target.value })} disabled={busy} />
            </Field>
            <Field label="Starts">
              <input type="datetime-local" value={draft.startsAt} onChange={e => set({ startsAt: e.target.value })} disabled={busy} />
            </Field>
            <Field label="Ends">
              <input type="datetime-local" value={draft.endsAt} onChange={e => set({ endsAt: e.target.value })} disabled={busy} />
            </Field>
          </div>
          <Field label="Description (shown to customers)" hint="Optional. Without one it reads “₹50 off”, “10% off up to ₹15” or “Free delivery”." wide>
            <input maxLength={200} value={draft.description} onChange={e => set({ description: e.target.value })} disabled={busy} />
          </Field>
          <fieldset style={{ margin: "14px 0 0" }}>
            <legend>Where it works</legend>
            <p style={{ fontSize: 12, color: "var(--admin-muted)", margin: "0 0 8px" }}>Tick zones to limit it. Tick none to allow every zone.</p>
            <div className="admin-role-choices">
              {zones.map(z => (
                <label key={z.id}><input type="checkbox" checked={draft.zoneIds.includes(z.id)} disabled={busy}
                  onChange={e => set({ zoneIds: e.target.checked ? [...draft.zoneIds, z.id] : draft.zoneIds.filter(x => x !== z.id) })} /> {z.name}</label>
              ))}
              {zones.length === 0 && <span style={{ fontSize: 12 }}>No zones found.</span>}
            </div>
          </fieldset>
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", marginTop: 14 }}>
            <label><input type="checkbox" checked={draft.firstOrderOnly} onChange={e => set({ firstOrderOnly: e.target.checked })} disabled={busy} /> First order only</label>
            <label><input type="checkbox" checked={draft.isActive} onChange={e => set({ isActive: e.target.checked })} disabled={busy} /> Active</label>
          </div>
          <div className="admin-role-actions" style={{ marginTop: 16, padding: 0 }}>
            <button className="admin-role-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save coupon"}</button>
            <button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}

      {usageFor && (
        <section className="admin-panel" style={{ marginBottom: 18 }}>
          <div className="admin-panel-toolbar">
            <h2>Usage of {usageFor.code}</h2>
            <button className="admin-text-button" onClick={() => setUsageFor(null)}>Close</button>
          </div>
          {!usage ? <p className="admin-roles-message">Loading…</p> : usage.rows.length === 0 ? <p className="admin-roles-message">Nobody has used this coupon yet.</p> : (
            <div style={{ overflowX: "auto" }}>
              <table className="admin-stock-table">
                <thead><tr><th>Customer</th><th>Order</th><th>Discount</th><th>When</th></tr></thead>
                <tbody>{usage.rows.map((u, i) => (
                  <tr key={i}><td>{u.customerName ?? u.userId}</td><td>{u.groupNo ?? u.orderGroupId}</td><td>{money(u.discountAmount)}</td><td>{dateTime(u.at)}</td></tr>
                ))}</tbody>
              </table>
              <p style={{ padding: "10px 24px", fontSize: 12, color: "var(--admin-muted)" }}>Total discount given: <strong>{money(usage.total)}</strong></p>
            </div>
          )}
        </section>
      )}

      <section className="admin-panel" aria-labelledby="coupons-title">
        <div className="admin-panel-toolbar">
          <h2 id="coupons-title">All coupons</h2>
          <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} aria-label="Filter coupons" style={{ ...inputStyle, width: "auto" }}>
            <option value="all">All</option><option value="true">Active</option><option value="false">Inactive</option>
          </select>
        </div>
        {list.loading && !list.data ? <p className="admin-roles-message" role="status">Loading…</p>
          : list.error ? <p className="admin-roles-message" role="alert">{list.error}</p>
          : coupons.length === 0 ? <p className="admin-roles-message">No coupons yet.{canManage ? " Click “+ New coupon” to create one." : ""}</p>
          : (
            <div style={{ overflowX: "auto" }}>
              <table className="admin-stock-table">
                <thead><tr><th>Code</th><th>Offer</th><th>Min order</th><th>Used</th><th>Valid</th><th>Zones</th><th>Status</th>{canManage && <th>Actions</th>}</tr></thead>
                <tbody>
                  {coupons.map(c => {
                    const s = state(c);
                    return (
                      <tr key={c.id}>
                        <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{c.code}{c.firstOrderOnly && <small style={{ display: "block", fontFamily: "inherit", fontWeight: 400, color: "var(--admin-muted)" }}>First order only</small>}</td>
                        <td>{offer(c)}</td>
                        <td>{c.minOrder ? money(c.minOrder) : "—"}</td>
                        <td>{c.usedCount}{c.totalLimit !== null ? ` / ${c.totalLimit}` : ""}{c.perUserLimit !== null && <small style={{ display: "block", color: "var(--admin-muted)" }}>{c.perUserLimit} per customer</small>}</td>
                        <td style={{ fontSize: 12 }}>{c.startsAt ? dateTime(c.startsAt) : "Now"} → {c.endsAt ? dateTime(c.endsAt) : "No end"}</td>
                        <td style={{ fontSize: 12 }}>{c.zoneIds.length === 0 ? "All zones" : c.zoneIds.map(zoneName).join(", ")}</td>
                        <td><Badge tone={s.tone}>{s.label}</Badge></td>
                        {canManage && (
                          <td>
                            <div className="admin-role-actions" style={{ padding: 0, gap: 6 }}>
                              <button onClick={() => open(c)} disabled={busy}>Edit</button>
                              <button onClick={() => void showUsage(c)}>Usage</button>
                              {c.isActive && (confirmId === c.id
                                ? <><button onClick={() => void deactivate(c)} disabled={busy} style={{ color: "#a73535" }}>Confirm</button><button onClick={() => setConfirmId(null)}>No</button></>
                                : <button onClick={() => setConfirmId(c.id)} disabled={busy}>Deactivate</button>)}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </>
  );
}
