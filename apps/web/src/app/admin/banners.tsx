"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, Badge, can, dateTime, errorText, Field, Heading, inputStyle, json, Notice, useWarehouses, useZones, usePolling } from "./admin-kit";
import { adminFetch, type AdminSession } from "./session-client";

type Link = { type: "category" | "product" | "url"; id?: string; url?: string } | null;
type Banner = { id: string; title: string; imageMediaId: string | null; link: Link; zoneId: string | null; sortOrder: number; startsAt: string | null; endsAt: string | null; isActive: boolean };
type Draft = { title: string; imageMediaId: string | null; linkType: "none" | "category" | "product" | "url"; linkId: string; url: string; zoneId: string; sortOrder: string; startsAt: string; endsAt: string; isActive: boolean };
type CategoryNode = { id: string; name: string; children?: CategoryNode[] };

const blank: Draft = { title: "", imageMediaId: null, linkType: "none", linkId: "", url: "", zoneId: "", sortOrder: "0", startsAt: "", endsAt: "", isActive: true };
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const flatten = (nodes: CategoryNode[], depth = 0): { id: string; label: string }[] => nodes.flatMap(n => [{ id: n.id, label: `${"— ".repeat(depth)}${n.name}` }, ...flatten(n.children ?? [], depth + 1)]);

const toDraft = (b: Banner): Draft => ({
  title: b.title, imageMediaId: b.imageMediaId, linkType: b.link?.type ?? "none", linkId: b.link?.id ?? "", url: b.link?.url ?? "",
  zoneId: b.zoneId ?? "", sortOrder: String(b.sortOrder), startsAt: toLocal(b.startsAt), endsAt: toLocal(b.endsAt), isActive: b.isActive,
});

function body(d: Draft) {
  let link: Link = null;
  if (d.linkType === "category" || d.linkType === "product") {
    if (!d.linkId) throw new Error(`Choose the ${d.linkType} this banner opens.`);
    link = { type: d.linkType, id: d.linkId };
  } else if (d.linkType === "url") {
    if (!d.url.startsWith("https://")) throw new Error("The link must start with https://");
    link = { type: "url", url: d.url.trim() };
  }
  return {
    title: d.title.trim(), imageMediaId: d.imageMediaId, link, zoneId: d.zoneId || null,
    sortOrder: Math.max(0, Math.floor(Number(d.sortOrder) || 0)), startsAt: fromLocal(d.startsAt), endsAt: fromLocal(d.endsAt), isActive: d.isActive,
  };
}

/** Uploads a banner image straight to storage, using the same signed-upload flow as product photos. Returns the media id. */
async function uploadBannerImage(file: File): Promise<string> {
  const call = async <T,>(path: string, init: RequestInit) => {
    const res = await adminFetch(`/api/v1/${path}`, init);
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out?.error?.message ?? "The image could not be uploaded.");
    return out as T;
  };
  const ticket = await call<{ data: { mediaId: string; upload: { url: string; method: string; fields: Record<string, string> } } }>("media/upload-url", json("POST", {
    kind: "banner", contentType: file.type || "image/jpeg", sizeBytes: file.size,
  }));
  const { url, method, fields } = ticket.data.upload;
  const form = new FormData();
  Object.entries(fields ?? {}).forEach(([k, v]) => form.append(k, v));
  form.append("file", file);
  const put = await fetch(url, { method: method || "POST", body: form });
  if (!put.ok) throw new Error("The image could not be uploaded to storage.");
  await call("media/complete", json("POST", { mediaId: ticket.data.mediaId }));
  return ticket.data.mediaId;
}

/** Shows a banner image by asking the API for a readable link. */
function Thumb({ mediaId, size = 64 }: { mediaId: string | null; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!mediaId) return;
    let live = true;
    void adminFetch(`/api/v1/media/${mediaId}/url`).then(r => r.json()).then(o => { if (live) setSrc(o?.data?.url ?? null); }).catch(() => undefined);
    return () => { live = false; };
  }, [mediaId]);
  const box = { width: size * 2, height: size, borderRadius: 6, background: "#f3f1ee", border: "1px solid var(--admin-border)", objectFit: "cover" as const, display: "block" };
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" style={box} /> : <div style={{ ...box, display: "grid", placeItems: "center", fontSize: 12, color: "var(--admin-muted)" }}>{mediaId ? "…" : "No image"}</div>;
}

export default function Banners({ session }: { session: AdminSession }) {
  const canManage = can(session.user.permissions, "pricing:manage");
  const warehouses = useWarehouses();
  const zones = useZones(warehouses);
  const list = usePolling(() => api<{ data: Banner[] }>("banners").then(r => r.data), 0);
  const [cats, setCats] = useState<{ id: string; label: string }[]>([]);
  const [prods, setProds] = useState<{ id: string; name: string }[]>([]);
  const [editing, setEditing] = useState<Banner | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    if (!cats.length) void api<{ data: CategoryNode[] }>("categories").then(r => setCats(flatten(r.data)), () => undefined);
    if (!prods.length) void api<{ data: { id: string; name: string }[] }>("products?limit=100&status=active").then(r => setProds(r.data), () => undefined);
  }, [editing, cats.length, prods.length]);

  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));
  const zoneName = (id: string | null) => (id ? zones.find(z => z.id === id)?.name ?? `Zone …${id.slice(-4)}` : "All zones");
  function open(b: Banner | "new") { setEditing(b); setDraft(b === "new" ? blank : toDraft(b)); setError(""); setNotice(""); }

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError("");
    try { set({ imageMediaId: await uploadBannerImage(file) }); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const payload = body(draft);
      if (editing === "new") await api("banners", json("POST", payload));
      else if (editing) await api(`banners/${editing.id}`, json("PUT", payload));
      setEditing(null); setNotice(editing === "new" ? "Banner created." : "Banner saved."); list.reload();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }

  async function remove(b: Banner) {
    setBusy(true); setError("");
    try { await api(`banners/${b.id}`, json("DELETE")); setConfirmId(null); setNotice("Banner deleted."); list.reload(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }

  const linkText = (l: Link) => !l ? "—" : l.type === "url" ? l.url : l.type === "category" ? `Category: ${cats.find(c => c.id === l.id)?.label ?? "…"}` : `Product: ${prods.find(p => p.id === l.id)?.name ?? "…"}`;
  function status(b: Banner): { tone: "active" | "paused" | "inactive"; label: string } {
    const now = Date.now();
    if (!b.isActive) return { tone: "inactive", label: "Hidden" };
    if (b.endsAt && new Date(b.endsAt).getTime() < now) return { tone: "inactive", label: "Ended" };
    if (b.startsAt && new Date(b.startsAt).getTime() > now) return { tone: "paused", label: "Scheduled" };
    return { tone: "active", label: "Live" };
  }
  const banners = [...(list.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <>
      <Heading title="Banners" subtitle="Promotional images shown on the customer app's home screen.">
        {canManage && <button className="admin-role-button" onClick={() => open("new")}>+ New banner</button>}
      </Heading>
      {notice && <Notice kind="ok">{notice}</Notice>}
      {error && !editing && <Notice>{error}</Notice>}

      {editing && (
        <form className="admin-panel admin-role-form" onSubmit={save} style={{ marginBottom: 18, padding: 22 }}>
          <h2>{editing === "new" ? "New banner" : "Edit banner"}</h2>
          {error && <Notice>{error}</Notice>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16, alignItems: "start" }}>
            <Field label="Title" hint="Shown to customers and used as the image description.">
              <input required maxLength={120} value={draft.title} onChange={e => set({ title: e.target.value })} placeholder="Free delivery above ₹399" disabled={busy} />
            </Field>
            <Field label="Show in" hint="Pick a zone, or all zones.">
              <select value={draft.zoneId} onChange={e => set({ zoneId: e.target.value })} disabled={busy}>
                <option value="">All zones</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </Field>
            <Field label="Order" hint="Smaller numbers show first.">
              <input type="number" min="0" step="1" value={draft.sortOrder} onChange={e => set({ sortOrder: e.target.value })} disabled={busy} />
            </Field>
            <Field label="Opens when tapped">
              <select value={draft.linkType} onChange={e => set({ linkType: e.target.value as Draft["linkType"], linkId: "", url: "" })} disabled={busy}>
                <option value="none">Nothing</option><option value="category">A category</option><option value="product">A product</option><option value="url">A web link</option>
              </select>
            </Field>
            {draft.linkType === "category" && (
              <Field label="Category">
                <select required value={draft.linkId} onChange={e => set({ linkId: e.target.value })} disabled={busy}>
                  <option value="">Select a category</option>{cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </Field>
            )}
            {draft.linkType === "product" && (
              <Field label="Product">
                <select required value={draft.linkId} onChange={e => set({ linkId: e.target.value })} disabled={busy}>
                  <option value="">Select a product</option>{prods.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
            )}
            {draft.linkType === "url" && (
              <Field label="Web link" hint="Must start with https://">
                <input required type="url" value={draft.url} onChange={e => set({ url: e.target.value })} placeholder="https://" style={inputStyle} disabled={busy} />
              </Field>
            )}
            <Field label="Starts"><input type="datetime-local" value={draft.startsAt} onChange={e => set({ startsAt: e.target.value })} disabled={busy} /></Field>
            <Field label="Ends"><input type="datetime-local" value={draft.endsAt} onChange={e => set({ endsAt: e.target.value })} disabled={busy} /></Field>
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Thumb mediaId={draft.imageMediaId} size={70} />
            <div>
              <label style={{ display: "inline-block", cursor: "pointer", border: "1px solid #cbc5ba", borderRadius: 6, padding: "8px 14px", background: "#fff", fontSize: 14 }}>
                {draft.imageMediaId ? "Replace image" : "Upload image"}
                <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} style={{ display: "none" }} onChange={e => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--admin-muted)" }}>JPEG, PNG or WebP. A wide image (about 2:1) works best.</p>
            </div>
          </div>
          <label style={{ marginTop: 14 }}><input type="checkbox" checked={draft.isActive} onChange={e => set({ isActive: e.target.checked })} disabled={busy} /> Visible to customers</label>
          <div className="admin-role-actions" style={{ marginTop: 16, padding: 0 }}>
            <button className="admin-role-button" type="submit" disabled={busy}>{busy ? "Working…" : "Save banner"}</button>
            <button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}

      <section className="admin-panel" aria-labelledby="banners-title">
        <div className="admin-panel-toolbar"><h2 id="banners-title">All banners</h2><span>{banners.length} total</span></div>
        {list.loading && !list.data ? <p className="admin-roles-message" role="status">Loading…</p>
          : list.error ? <p className="admin-roles-message" role="alert">{list.error}</p>
          : banners.length === 0 ? <p className="admin-roles-message">No banners yet.{canManage ? " Click “+ New banner” to add one." : ""}</p>
          : (
            <div style={{ overflowX: "auto" }}>
              <table className="admin-stock-table">
                <thead><tr><th>Image</th><th>Title</th><th>Opens</th><th>Zone</th><th>Order</th><th>Schedule</th><th>Status</th>{canManage && <th>Actions</th>}</tr></thead>
                <tbody>
                  {banners.map(b => {
                    const s = status(b);
                    return (
                      <tr key={b.id}>
                        <td><Thumb mediaId={b.imageMediaId} size={40} /></td>
                        <td style={{ fontWeight: 500 }}>{b.title}</td>
                        <td style={{ fontSize: 14, maxWidth: 220, overflowWrap: "anywhere" }}>{linkText(b.link)}</td>
                        <td style={{ fontSize: 14 }}>{zoneName(b.zoneId)}</td>
                        <td>{b.sortOrder}</td>
                        <td style={{ fontSize: 14 }}>{b.startsAt ? dateTime(b.startsAt) : "Now"} → {b.endsAt ? dateTime(b.endsAt) : "No end"}</td>
                        <td><Badge tone={s.tone}>{s.label}</Badge></td>
                        {canManage && (
                          <td>
                            <div className="admin-role-actions" style={{ padding: 0, gap: 6 }}>
                              <button onClick={() => open(b)} disabled={busy}>Edit</button>
                              {confirmId === b.id
                                ? <><button onClick={() => void remove(b)} disabled={busy} style={{ color: "#a73535" }}>Confirm delete</button><button onClick={() => setConfirmId(null)}>No</button></>
                                : <button onClick={() => setConfirmId(b.id)} disabled={busy}>Delete</button>}
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
