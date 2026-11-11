"use client";

import { useEffect, useState, type FormEvent } from "react";
import { adminFetch, type AdminSession } from "./session-client";
import { BrandManager, ProductManager, type Brand } from "./catalog-products";

// ─── Types ───────────────────────────────────────────────────────────────────

type Category = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  imageMediaId?: string | null;
  imageUrls?: Record<string, string>;
  children?: Category[];
};

const categoryPhoto = (c: Category) => c.imageUrls?.thumb ?? c.imageUrls?.["320"] ?? c.imageUrls?.small ?? Object.values(c.imageUrls ?? {})[0] ?? "";

/** Uploads a picture for a category and returns its media id. */
async function uploadCategoryImage(categoryId: string, file: File): Promise<string> {
  const post = async (path: string, body: unknown) => {
    const res = await adminFetch(`/api/v1/${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { error?: { message?: string } }).error?.message ?? "The picture could not be uploaded.");
    return json;
  };
  const ticket = (await post("media/upload-url", { kind: "category_image", contentType: file.type || "image/jpeg", sizeBytes: file.size, ownerRef: { type: "category", id: categoryId } })) as { data: { mediaId: string; upload: { url: string; method: string; fields: Record<string, string> } } };
  const { url, method, fields } = ticket.data.upload;
  const form = new FormData();
  Object.entries(fields ?? {}).forEach(([k, v]) => form.append(k, v));
  form.append("file", file);
  const put = await fetch(url, { method: method || "POST", body: form });
  if (!put.ok) throw new Error("The picture could not be uploaded to storage.");
  await post("media/complete", { mediaId: ticket.data.mediaId });
  return ticket.data.mediaId;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function api<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await adminFetch(`/api/v1/admin/${path}`, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? "The request could not be completed.");
  return body;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Category Manager ────────────────────────────────────────────────────────

function CategoryRow({
  cat,
  depth,
  categories,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
  canEdit,
}: {
  cat: Category;
  depth: number;
  categories: Category[];
  onMoveUp: (cat: Category) => void;
  onMoveDown: (cat: Category) => void;
  onEdit: (cat: Category) => void;
  onDelete: (cat: Category) => void;
  canEdit: boolean;
}) {
  const siblings = categories.filter((c) => c.parentId === cat.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const idx = siblings.findIndex((c) => c.id === cat.id);
  return (
    <>
      <div className="admin-tree-row" style={{ "--depth": depth } as React.CSSProperties}>
        <span className="admin-tree-indent" />
        {categoryPhoto(cat)
          ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={categoryPhoto(cat)} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />
          : <span aria-hidden="true" title="No photo yet" style={{ width: 40, height: 40, borderRadius: 8, background: "#fff3cc", flexShrink: 0 }} />}
        <span style={{ flex: 1 }}>
          <strong>{cat.name}</strong>
          <small style={{ marginLeft: 8, color: "var(--admin-muted)", fontSize: 11 }}>/{cat.slug}</small>
        </span>
        {canEdit && (
          <div className="admin-role-actions" style={{ padding: 0, gap: 6 }}>
            <button disabled={idx === 0} onClick={() => onMoveUp(cat)} title="Move up" aria-label={`Move ${cat.name} up`} style={{ minHeight: 30, padding: "4px 8px" }}>↑</button>
            <button disabled={idx === siblings.length - 1} onClick={() => onMoveDown(cat)} title="Move down" aria-label={`Move ${cat.name} down`} style={{ minHeight: 30, padding: "4px 8px" }}>↓</button>
            <button onClick={() => onEdit(cat)} style={{ minHeight: 30, padding: "4px 10px" }}>Edit</button>
            <button onClick={() => onDelete(cat)} style={{ minHeight: 30, padding: "4px 10px", color: "#a73535" }}>Delete</button>
          </div>
        )}
      </div>
      {cat.children?.map((child) => (
        <CategoryRow
          key={child.id}
          cat={child}
          depth={depth + 1}
          categories={[...categories, ...(cat.children ?? [])]}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onEdit={onEdit}
          onDelete={onDelete}
          canEdit={canEdit}
        />
      ))}
    </>
  );
}

function CategoryManager({ canEdit }: { canEdit: boolean }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [attempt, setAttempt] = useState(0);

  // form fields
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [autoSlug, setAutoSlug] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [removePhoto, setRemovePhoto] = useState(false);

  function choosePhoto(file: File | null) {
    setPhoto(file); setRemovePhoto(false);
    setPhotoPreview((old) => { if (old.startsWith("blob:")) URL.revokeObjectURL(old); return file ? URL.createObjectURL(file) : ""; });
  }

  const [deleting, setDeleting] = useState<Category | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<{ data: Category[] }>("categories", { signal: controller.signal })
      .then((body) => { if (!controller.signal.aborted) setCategories(body.data); })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Categories could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);

  // Flatten for parent picker and sibling reorder
  function flatten(cats: Category[], acc: Category[] = []): Category[] {
    for (const c of cats) {
      acc.push(c);
      if (c.children) flatten(c.children, acc);
    }
    return acc;
  }
  const flat = flatten(categories);

  function startEdit(cat: Category | "new") {
    setEditing(cat);
    setFormError("");
    setDeleting(null);
    setPhoto(null); setRemovePhoto(false);
    setPhotoPreview(cat === "new" ? "" : categoryPhoto(cat));
    if (cat === "new") {
      setName(""); setSlug(""); setParentId(""); setAutoSlug(true); setIsActive(true); setIsActive(true);
    } else {
      setName(cat.name); setSlug(cat.slug); setParentId(cat.parentId ?? ""); setAutoSlug(false); setIsActive(cat.isActive);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setFormError("");
    try {
      const isNew = editing === "new";
      const siblings = flat.filter((c) => c.parentId === (parentId || null) && (isNew || c.id !== (editing as Category).id));
      const sortOrder = isNew ? (siblings.length > 0 ? Math.max(...siblings.map((s) => s.sortOrder)) + 1 : 0) : (editing as Category).sortOrder;
      const payload = isNew ? { name: name.trim(), parentId: parentId || null, sortOrder } : { name: name.trim(), parentId: parentId || null, sortOrder, isActive };
      const saved = await api<{ data: { id: string } }>(isNew ? "categories" : `categories/${(editing as Category).id}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify(payload),
      });
      const id = isNew ? saved.data.id : (editing as Category).id;
      if (photo || removePhoto) {
        try {
          const imageMediaId = photo ? await uploadCategoryImage(id, photo) : null;
          await api(`categories/${id}`, { method: "PUT", headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" }, body: JSON.stringify({ imageMediaId }) });
        } catch (err) {
          setEditing(null); setAttempt((v) => v + 1);
          setFormError(`The category was saved, but its photo was not: ${err instanceof Error ? err.message : "upload failed"}. Edit the category to try again.`);
          return;
        }
      }
      setEditing(null);
      setNotice(isNew ? "Category created." : "Category updated.");
      setAttempt((v) => v + 1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Category could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function reorder(movedId: string, siblings: Category[], direction: "up" | "down") {
    const sorted = [...siblings].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((c) => c.id === movedId);
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === sorted.length - 1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    [sorted[idx], sorted[swapIdx]] = [sorted[swapIdx]!, sorted[idx]!];
    const ids = sorted.map((c) => c.id);
    setBusy(true);
    try {
      await api("categories/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ parentId: siblings[0]?.parentId ?? null, orderedIds: ids }),
      });
      setAttempt((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reorder failed.");
    } finally {
      setBusy(false);
    }
  }

  function handleMoveUp(cat: Category) {
    const siblings = flat.filter((c) => c.parentId === cat.parentId);
    void reorder(cat.id, siblings, "up");
  }
  function handleMoveDown(cat: Category) {
    const siblings = flat.filter((c) => c.parentId === cat.parentId);
    void reorder(cat.id, siblings, "down");
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true); setFormError("");
    try {
      await api(`categories/${deleting.id}`, { method: "DELETE", headers: { "X-CSRF-Token": "1" } });
      setDeleting(null);
      setNotice("Category deleted.");
      setAttempt((v) => v + 1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Category could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="admin-heading" style={{ marginBottom: 20 }}>
        <div>
          <h1>Categories</h1>
          <p>Manage the product category hierarchy.</p>
        </div>
        <div className="admin-role-actions" style={{ padding: 0 }}>
          <button className="admin-text-button" disabled={loading || busy} onClick={() => setAttempt((v) => v + 1)}>Reload</button>
          {canEdit && <button className="admin-role-button" disabled={busy} onClick={() => startEdit("new")}>Add category</button>}
        </div>
      </div>

      {notice && <p role="status" style={{ color: "#137333", marginBottom: 12 }}>{notice}</p>}
      {error && <p role="alert" className="admin-role-error" style={{ marginBottom: 12 }}>{error}</p>}
      {formError && <p role="alert" className="admin-role-error" style={{ marginBottom: 12 }}>{formError}</p>}

      {editing && (
        <form className="admin-panel admin-role-form" onSubmit={save} aria-label={editing === "new" ? "Create category" : "Edit category"} style={{ marginBottom: 20 }}>
          <h2 style={{ marginBottom: 16 }}>{editing === "new" ? "New category" : `Edit — ${(editing as Category).name}`}</h2>
          <div style={{ display: "grid", gap: 12, maxWidth: 480 }}>
            <label htmlFor="cat-name">Name
              <input id="cat-name" required maxLength={120} value={name} disabled={busy}
                onChange={(e) => { setName(e.target.value); if (autoSlug) setSlug(slugify(e.target.value)); }}
                style={{ display: "block", marginTop: 6, width: "100%", padding: 10, border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit" }}
              />
            </label>
            <small style={{ color: "var(--admin-muted)" }}>URL slug is generated automatically: /{slugify(name) || "…"}</small>
            <div>
              <span style={{ display: "block", marginBottom: 6 }}>Photo (shown to customers on the category tile)</span>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                {photoPreview && !removePhoto
                  ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={photoPreview} alt="Category photo preview" style={{ width: 88, height: 88, objectFit: "cover", borderRadius: 12, border: "1px solid #cbc5ba" }} />
                  : <span style={{ width: 88, height: 88, borderRadius: 12, background: "#fff3cc", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#8a5a00" }}>No photo</span>}
                <span style={{ display: "grid", gap: 6 }}>
                  <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} aria-label="Choose category photo" onChange={(e) => choosePhoto(e.target.files?.[0] ?? null)} />
                  {(photoPreview && !removePhoto) && <button type="button" disabled={busy} onClick={() => { choosePhoto(null); setRemovePhoto(true); }} style={{ justifySelf: "start", minHeight: 30, padding: "4px 10px" }}>Remove photo</button>}
                </span>
              </div>
            </div>
            {editing !== "new" && <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={isActive} disabled={busy} onChange={(e) => setIsActive(e.target.checked)} /> Active (visible to customers)</label>}
            <label htmlFor="cat-parent">Parent category (optional)
              <select id="cat-parent" value={parentId} disabled={busy}
                onChange={(e) => setParentId(e.target.value)}
                style={{ display: "block", marginTop: 6, width: "100%", padding: 10, border: "1px solid #cbc5ba", borderRadius: 6, font: "inherit" }}
              >
                <option value="">— Top level —</option>
                {flat
                  .filter((c) => editing === "new" || c.id !== (editing as Category).id)
                  .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>
          <div className="admin-role-actions" style={{ marginTop: 16, padding: 0 }}>
            <button className="admin-role-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save category"}</button>
            <button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}

      {deleting && (
        <div className="admin-panel" style={{ padding: 20, marginBottom: 20 }}>
          <p>Delete <strong>{deleting.name}</strong>? This cannot be undone if the category is not in use.</p>
          <div className="admin-role-actions" style={{ padding: 0, marginTop: 12 }}>
            <button className="admin-role-button" style={{ background: "#a73535" }} disabled={busy} onClick={confirmDelete}>{busy ? "Deleting…" : "Confirm delete"}</button>
            <button disabled={busy} onClick={() => setDeleting(null)}>Cancel</button>
          </div>
        </div>
      )}

      <section className="admin-panel" aria-labelledby="categories-title">
        <div className="admin-panel-toolbar">
          <h2 id="categories-title">Category tree</h2>
          <span>{flat.length} categories</span>
        </div>
        {loading ? (
          <p className="admin-roles-message" role="status">Loading categories…</p>
        ) : categories.length === 0 ? (
          <p className="admin-roles-message">No categories yet. Create your first one.</p>
        ) : (
          <div className="admin-tree">
            {categories
              .filter((c) => c.parentId === null)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((cat) => (
                <CategoryRow
                  key={cat.id}
                  cat={cat}
                  depth={0}
                  categories={flat}
                  onMoveUp={handleMoveUp}
                  onMoveDown={handleMoveDown}
                  onEdit={startEdit}
                  onDelete={(c) => { setDeleting(c); setEditing(null); setFormError(""); }}
                  canEdit={canEdit}
                />
              ))}
          </div>
        )}
      </section>
    </>
  );
}

// ─── Catalog Export ───────────────────────────────────────────────────────────

function CatalogExport() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setBusy(true); setError("");
    try {
      const res = await adminFetch(`/api/v1/admin/catalog/export`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: { message?: string } }).error?.message ?? "Export failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `catalog-export.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="admin-heading" style={{ marginBottom: 20 }}>
        <div>
          <h1>Export catalog</h1>
          <p>Download the full master catalog as a CSV file.</p>
        </div>
      </div>
      <section className="admin-panel" aria-labelledby="export-title" style={{ maxWidth: 480 }}>
        <div className="admin-panel-toolbar"><h2 id="export-title">Download</h2></div>
        <div style={{ padding: 24, display: "grid", gap: 16 }}>
          {error && <p role="alert" className="admin-role-error">{error}</p>}
          <button className="admin-role-button" onClick={download} disabled={busy}>{busy ? "Exporting…" : "Download CSV"}</button>
        </div>
      </section>
    </>
  );
}

// ─── Root Catalog Component ───────────────────────────────────────────────────

type Tab = "categories" | "products" | "brands" | "export";

export default function Catalog({ session }: { session: AdminSession }) {
  const [tab, setTab] = useState<Tab>("categories");
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandAttempt, setBrandAttempt] = useState(0);

  const canEdit =
    session.user.permissions.includes("*") ||
    session.user.permissions.includes("catalog:manage");

  // The category tree and brands are shared with the product form; reload whenever a tab is opened.
  useEffect(() => {
    void api<{ data: Category[] }>("categories").then((body) => setCategories(body.data)).catch(() => {});
  }, [tab]);
  useEffect(() => {
    void api<{ data: Brand[] }>("brands").then((body) => setBrands(body.data)).catch(() => {});
  }, [brandAttempt]);

  const labels: Record<Tab, string> = { categories: "Categories", products: "Products & variants", brands: "Brands", export: "Export" };
  return (
    <>
      <div className="admin-tab-nav" role="tablist" aria-label="Catalog sections">
        {(Object.keys(labels) as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "is-active" : ""} onClick={() => setTab(t)}>{labels[t]}</button>
        ))}
      </div>
      {tab === "categories" ? (
        <CategoryManager canEdit={canEdit} />
      ) : tab === "products" ? (
        <ProductManager categories={categories} brands={brands} canEdit={canEdit} />
      ) : tab === "brands" ? (
        <BrandManager brands={brands} canEdit={canEdit} onChanged={() => setBrandAttempt((n) => n + 1)} />
      ) : (
        <CatalogExport />
      )}
    </>
  );
}
