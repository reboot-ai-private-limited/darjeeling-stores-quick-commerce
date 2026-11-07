"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { adminFetch, type AdminSession } from "./session-client";

// ─── Types ───────────────────────────────────────────────────────────────────

type Category = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  displayOrder: number;
  children?: Category[];
};

type Variant = {
  id: string;
  unit: string;
  packSize: string;
  barcode: string;
};

type ProductImage = {
  id: string;
  url: string;
  order: number;
};

type Product = {
  id: string;
  title: string;
  brand: string;
  categoryId: string;
  description: string;
  foodType: string;
  taxRate: number;
  hsnCode: string;
  status: "active" | "archived";
  variants: Variant[];
  images: ProductImage[];
};

type ProductRow = {
  id: string;
  title: string;
  brand: string;
  categoryId: string;
  status: "active" | "archived";
  variantCount: number;
};

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
  const siblings = categories.filter((c) => c.parentId === cat.parentId).sort((a, b) => a.displayOrder - b.displayOrder);
  const idx = siblings.findIndex((c) => c.id === cat.id);
  return (
    <>
      <div className="admin-tree-row" style={{ "--depth": depth } as React.CSSProperties}>
        <span className="admin-tree-indent" />
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
    if (cat === "new") {
      setName(""); setSlug(""); setParentId(""); setAutoSlug(true);
    } else {
      setName(cat.name); setSlug(cat.slug); setParentId(cat.parentId ?? ""); setAutoSlug(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setFormError("");
    try {
      const isNew = editing === "new";
      const siblings = flat.filter((c) => c.parentId === (parentId || null) && (isNew || c.id !== (editing as Category).id));
      const displayOrder = isNew ? (siblings.length > 0 ? Math.max(...siblings.map((s) => s.displayOrder)) + 1 : 0) : (editing as Category).displayOrder;
      const payload = { name, slug, ...(parentId ? { parentId } : { parentId: null }), displayOrder };
      await api(isNew ? "categories" : `categories/${(editing as Category).id}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify(payload),
      });
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
    const sorted = [...siblings].sort((a, b) => a.displayOrder - b.displayOrder);
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
        body: JSON.stringify({ ids }),
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
                style={{ display: "block", marginTop: 6, width: "100%", padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }}
              />
            </label>
            <label htmlFor="cat-slug">Slug
              <input id="cat-slug" required maxLength={120} pattern="[a-z0-9-]+" value={slug} disabled={busy}
                onChange={(e) => { setSlug(e.target.value); setAutoSlug(false); }}
                style={{ display: "block", marginTop: 6, width: "100%", padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }}
              />
            </label>
            <label htmlFor="cat-parent">Parent category (optional)
              <select id="cat-parent" value={parentId} disabled={busy}
                onChange={(e) => setParentId(e.target.value)}
                style={{ display: "block", marginTop: 6, width: "100%", padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }}
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
              .sort((a, b) => a.displayOrder - b.displayOrder)
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

// ─── Variant Editor ───────────────────────────────────────────────────────────

function VariantEditor({
  productId,
  variant,
  onSaved,
  onCancel,
}: {
  productId: string;
  variant: Variant | "new";
  onSaved: () => void;
  onCancel: () => void;
}) {
  const isNew = variant === "new";
  const [unit, setUnit] = useState(isNew ? "" : variant.unit);
  const [packSize, setPackSize] = useState(isNew ? "" : variant.packSize);
  const [barcode, setBarcode] = useState(isNew ? "" : variant.barcode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dupWarning, setDupWarning] = useState("");

  async function checkBarcode() {
    if (!barcode.trim()) return;
    try {
      const body = await api<{ data: { duplicate: boolean } }>("products/check-duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ barcode: barcode.trim() }),
      });
      if (body.data?.duplicate) setDupWarning("This barcode is already in use.");
      else setDupWarning("");
    } catch { /* ignore barcode check errors */ }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const payload = { unit, packSize, barcode };
      if (isNew) {
        await api(`products/${productId}/variants`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
          body: JSON.stringify(payload),
        });
      } else {
        await api(`products/${productId}/variants/${variant.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
          body: JSON.stringify(payload),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Variant could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} style={{ display: "grid", gap: 10, padding: "12px 0", borderTop: "1px solid var(--admin-border)" }}>
      <strong style={{ fontSize: 12 }}>{isNew ? "Add variant" : "Edit variant"}</strong>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label style={{ flex: 1, minWidth: 120, fontSize: 12 }}>Unit
          <input required maxLength={40} value={unit} disabled={busy} onChange={(e) => setUnit(e.target.value)}
            style={{ display: "block", marginTop: 4, width: "100%", padding: "7px 10px", border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }}
          />
        </label>
        <label style={{ flex: 1, minWidth: 120, fontSize: 12 }}>Pack size
          <input required maxLength={40} value={packSize} disabled={busy} onChange={(e) => setPackSize(e.target.value)}
            style={{ display: "block", marginTop: 4, width: "100%", padding: "7px 10px", border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }}
          />
        </label>
        <label style={{ flex: 1, minWidth: 140, fontSize: 12 }}>Barcode
          <input maxLength={80} value={barcode} disabled={busy}
            onChange={(e) => { setBarcode(e.target.value); setDupWarning(""); }}
            onBlur={checkBarcode}
            style={{ display: "block", marginTop: 4, width: "100%", padding: "7px 10px", border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }}
          />
          {dupWarning && <span style={{ color: "#b06000", fontSize: 11 }}>{dupWarning}</span>}
        </label>
      </div>
      {error && <p role="alert" style={{ color: "#a73535", fontSize: 12, margin: 0 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="admin-role-button" type="submit" disabled={busy} style={{ minHeight: 34, padding: "6px 12px", fontSize: 12 }}>{busy ? "Saving…" : isNew ? "Add variant" : "Save"}</button>
        <button type="button" disabled={busy} onClick={onCancel} style={{ minHeight: 34, padding: "6px 12px", border: "1px solid #bacbbd", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 12 }}>Cancel</button>
      </div>
    </form>
  );
}

// ─── Image Manager ────────────────────────────────────────────────────────────

function ImageManager({ productId, images, onChanged }: { productId: string; images: ProductImage[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError("");
    const fd = new FormData();
    fd.append("image", file);
    try {
      const res = await adminFetch(`/api/v1/admin/products/${productId}/images`, {
        method: "POST",
        headers: { "X-CSRF-Token": "1" },
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Upload failed.");
      onChanged();
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteImage(mediaId: string) {
    setBusy(true); setError("");
    try {
      await api(`products/${productId}/images/${mediaId}`, { method: "DELETE", headers: { "X-CSRF-Token": "1" } });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function moveImage(mediaId: string, direction: "up" | "down") {
    const sorted = [...images].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((img) => img.id === mediaId);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    [sorted[idx], sorted[swapIdx]] = [sorted[swapIdx]!, sorted[idx]!];
    setBusy(true);
    try {
      await api(`products/${productId}/images/order`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ order: sorted.map((img) => img.id) }),
      });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reorder failed.");
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...images].sort((a, b) => a.order - b.order);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <strong style={{ fontSize: 12 }}>Images ({images.length})</strong>
        <label style={{ cursor: "pointer", fontSize: 12 }}>
          <span className="admin-role-button" style={{ display: "inline-block", padding: "6px 12px", fontSize: 12, minHeight: 32, lineHeight: "20px", opacity: busy ? 0.6 : 1 }}
          >{busy ? "Uploading…" : "Upload image"}</span>
          <input ref={fileRef} type="file" accept="image/*" disabled={busy} onChange={upload} style={{ display: "none" }} />
        </label>
      </div>
      {error && <p role="alert" style={{ color: "#a73535", fontSize: 12, margin: "0 0 8px" }}>{error}</p>}
      <div className="admin-image-grid">
        {sorted.map((img, i) => (
          <div key={img.id} className="admin-image-thumb">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt={`Product image ${i + 1}`} />
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 2 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button disabled={busy || i === 0} onClick={() => moveImage(img.id, "up")} aria-label="Move image left" style={{ background: "rgba(0,0,0,0.5)", color: "#fff", border: 0, borderRadius: 3, width: 20, height: 20, cursor: "pointer", fontSize: 10, display: "grid", placeItems: "center" }}>←</button>
                <button disabled={busy} onClick={() => deleteImage(img.id)} aria-label="Delete image" style={{ background: "rgba(167,53,53,0.85)", color: "#fff", border: 0, borderRadius: 3, width: 20, height: 20, cursor: "pointer", fontSize: 10, display: "grid", placeItems: "center" }}>✕</button>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button disabled={busy || i === sorted.length - 1} onClick={() => moveImage(img.id, "down")} aria-label="Move image right" style={{ background: "rgba(0,0,0,0.5)", color: "#fff", border: 0, borderRadius: 3, width: 20, height: 20, cursor: "pointer", fontSize: 10, display: "grid", placeItems: "center" }}>→</button>
              </div>
            </div>
          </div>
        ))}
        {sorted.length === 0 && <p style={{ fontSize: 12, color: "var(--admin-muted)" }}>No images yet.</p>}
      </div>
    </div>
  );
}

// ─── Product Detail Panel ─────────────────────────────────────────────────────

function ProductDetail({
  product,
  categories,
  canEdit,
  onBack,
  onChanged,
}: {
  product: Product;
  categories: Category[];
  canEdit: boolean;
  onBack: () => void;
  onChanged: (updated: Product) => void;
}) {
  const [current, setCurrent] = useState<Product>(product);
  const [editingVariant, setEditingVariant] = useState<Variant | "new" | null>(null);
  const [deletingVariant, setDeletingVariant] = useState<Variant | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingMeta, setEditingMeta] = useState(false);

  // meta edit fields
  const [title, setTitle] = useState(current.title);
  const [brand, setBrand] = useState(current.brand);
  const [categoryId, setCategoryId] = useState(current.categoryId);
  const [description, setDescription] = useState(current.description);
  const [foodType, setFoodType] = useState(current.foodType);
  const [taxRate, setTaxRate] = useState(String(current.taxRate));
  const [hsnCode, setHsnCode] = useState(current.hsnCode);

  function flatten(cats: Category[], acc: Category[] = []): Category[] {
    for (const c of cats) { acc.push(c); if (c.children) flatten(c.children, acc); }
    return acc;
  }
  const flatCats = flatten(categories);

  async function reload() {
    try {
      const body = await api<{ data: Product }>(`products/${current.id}`);
      setCurrent(body.data);
      onChanged(body.data);
    } catch { /* silent */ }
  }

  async function saveMeta(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api(`products/${current.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ title, brand, categoryId, description, foodType, taxRate: parseFloat(taxRate) || 0, hsnCode }),
      });
      setEditingMeta(false);
      setNotice("Product updated.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function archiveRestore() {
    const action = current.status === "active" ? "archive" : "restore";
    setBusy(true); setError("");
    try {
      await api(`products/${current.id}/${action}`, { method: "POST", headers: { "X-CSRF-Token": "1" } });
      setNotice(`Product ${action}d.`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteVariant() {
    if (!deletingVariant) return;
    setBusy(true); setError("");
    try {
      await api(`products/${current.id}/variants/${deletingVariant.id}`, { method: "DELETE", headers: { "X-CSRF-Token": "1" } });
      setDeletingVariant(null);
      setNotice("Variant removed.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Variant could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="admin-heading" style={{ marginBottom: 20 }}>
        <div>
          <button className="admin-text-button" onClick={onBack} style={{ marginBottom: 8 }}>← Back to products</button>
          <h1 style={{ fontSize: 22, margin: 0 }}>{current.title}</h1>
          <p style={{ margin: "4px 0 0" }}>
            <span className={`admin-badge ${current.status === "active" ? "admin-badge-active" : "admin-badge-disabled"}`}>{current.status}</span>
            {" "}<span style={{ fontSize: 12, color: "var(--admin-muted)" }}>{current.brand}</span>
          </p>
        </div>
        {canEdit && (
          <div className="admin-role-actions" style={{ padding: 0, flexWrap: "wrap" }}>
            <button className="admin-role-button" disabled={busy} onClick={() => setEditingMeta(!editingMeta)}>{editingMeta ? "Cancel edit" : "Edit details"}</button>
            <button disabled={busy} onClick={archiveRestore} style={{ border: "1px solid #bacbbd", borderRadius: 6, padding: "9px 12px", background: "#fff", cursor: "pointer", fontSize: 12 }}>
              {current.status === "active" ? "Archive" : "Restore"}
            </button>
          </div>
        )}
      </div>

      {notice && <p role="status" style={{ color: "#137333", marginBottom: 12 }}>{notice}</p>}
      {error && <p role="alert" className="admin-role-error" style={{ marginBottom: 12 }}>{error}</p>}

      {editingMeta && (
        <form className="admin-panel admin-role-form" onSubmit={saveMeta} style={{ marginBottom: 20 }}>
          <h2>Edit product details</h2>
          <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
            <label htmlFor="prod-title">Title
              <input id="prod-title" required maxLength={240} value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)}
                style={{ display: "block", marginTop: 6, width: "100%", padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }} />
            </label>
            <label htmlFor="prod-brand">Brand
              <input id="prod-brand" maxLength={120} value={brand} disabled={busy} onChange={(e) => setBrand(e.target.value)}
                style={{ display: "block", marginTop: 6, width: "100%", padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }} />
            </label>
            <label htmlFor="prod-cat">Category
              <select id="prod-cat" value={categoryId} disabled={busy} onChange={(e) => setCategoryId(e.target.value)}
                style={{ display: "block", marginTop: 6, width: "100%", padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }}>
                <option value="">— Uncategorised —</option>
                {flatCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <div style={{ display: "flex", gap: 12 }}>
              <label style={{ flex: 1 }}>Food type
                <select value={foodType} disabled={busy} onChange={(e) => setFoodType(e.target.value)}
                  style={{ display: "block", marginTop: 6, width: "100%", padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }}>
                  <option value="">Not specified</option>
                  <option value="veg">Vegetarian</option>
                  <option value="non_veg">Non-vegetarian</option>
                  <option value="egg">Egg</option>
                </select>
              </label>
              <label style={{ width: 120 }}>Tax rate (%)
                <input type="number" min="0" max="100" step="0.01" value={taxRate} disabled={busy} onChange={(e) => setTaxRate(e.target.value)}
                  style={{ display: "block", marginTop: 6, width: "100%", padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }} />
              </label>
              <label style={{ width: 140 }}>HSN code
                <input maxLength={20} value={hsnCode} disabled={busy} onChange={(e) => setHsnCode(e.target.value)}
                  style={{ display: "block", marginTop: 6, width: "100%", padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }} />
              </label>
            </div>
            <label htmlFor="prod-desc">Description
              <textarea id="prod-desc" maxLength={2000} value={description} disabled={busy} onChange={(e) => setDescription(e.target.value)}
                style={{ display: "block", marginTop: 6, width: "100%", minHeight: 80, padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit", resize: "vertical" }} />
            </label>
          </div>
          <div className="admin-role-actions" style={{ marginTop: 16, padding: 0 }}>
            <button className="admin-role-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
            <button type="button" disabled={busy} onClick={() => setEditingMeta(false)}>Cancel</button>
          </div>
        </form>
      )}

      {/* Variants */}
      <section className="admin-panel" aria-labelledby="variants-title" style={{ marginBottom: 20 }}>
        <div className="admin-panel-toolbar">
          <h2 id="variants-title">SKU Variants ({current.variants.length})</h2>
          {canEdit && !editingVariant && (
            <button className="admin-role-button" style={{ padding: "6px 12px", fontSize: 12, minHeight: 32 }} onClick={() => setEditingVariant("new")}>Add variant</button>
          )}
        </div>
        <div style={{ padding: "0 24px 16px" }}>
          {current.variants.length === 0 && !editingVariant && (
            <p style={{ fontSize: 12, color: "var(--admin-muted)", paddingTop: 12 }}>No variants yet.</p>
          )}
          <div className="admin-variant-list">
            {current.variants.map((v) => (
              <div key={v.id}>
                {editingVariant !== "new" && deletingVariant?.id !== v.id && editingVariant?.id !== v.id && (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--admin-border)", fontSize: 13 }}>
                    <span style={{ flex: 1 }}><strong>{v.unit}</strong> · {v.packSize}</span>
                    <span style={{ color: "var(--admin-muted)", fontFamily: "monospace", fontSize: 12 }}>{v.barcode || "—"}</span>
                    {canEdit && (
                      <div className="admin-role-actions" style={{ padding: 0, gap: 6 }}>
                        <button onClick={() => { setEditingVariant(v); setDeletingVariant(null); }} style={{ border: "1px solid #bacbbd", borderRadius: 6, padding: "5px 10px", background: "#fff", cursor: "pointer", fontSize: 12 }}>Edit</button>
                        <button onClick={() => { setDeletingVariant(v); setEditingVariant(null); }} style={{ border: "1px solid #bacbbd", borderRadius: 6, padding: "5px 10px", background: "#fff", cursor: "pointer", fontSize: 12, color: "#a73535" }}>Remove</button>
                      </div>
                    )}
                  </div>
                )}
                {editingVariant !== "new" && editingVariant?.id === v.id && (
                  <VariantEditor productId={current.id} variant={v} onSaved={async () => { setEditingVariant(null); setNotice("Variant saved."); await reload(); }} onCancel={() => setEditingVariant(null)} />
                )}
                {deletingVariant?.id === v.id && (
                  <div style={{ padding: "10px 0", borderBottom: "1px solid var(--admin-border)" }}>
                    <p style={{ fontSize: 12, margin: "0 0 8px" }}>Remove <strong>{v.unit} · {v.packSize}</strong>?</p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="admin-role-button" style={{ background: "#a73535", padding: "6px 12px", fontSize: 12, minHeight: 32 }} disabled={busy} onClick={deleteVariant}>{busy ? "Removing…" : "Confirm remove"}</button>
                      <button disabled={busy} onClick={() => setDeletingVariant(null)} style={{ border: "1px solid #bacbbd", borderRadius: 6, padding: "6px 12px", background: "#fff", cursor: "pointer", fontSize: 12 }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {editingVariant === "new" && (
              <VariantEditor productId={current.id} variant="new" onSaved={async () => { setEditingVariant(null); setNotice("Variant added."); await reload(); }} onCancel={() => setEditingVariant(null)} />
            )}
          </div>
        </div>
      </section>

      {/* Images */}
      <section className="admin-panel" aria-labelledby="images-title">
        <div className="admin-panel-toolbar">
          <h2 id="images-title">Images</h2>
        </div>
        <div style={{ padding: "12px 24px 20px" }}>
          {canEdit ? (
            <ImageManager productId={current.id} images={current.images} onChanged={reload} />
          ) : (
            <div className="admin-image-grid">
              {current.images.sort((a, b) => a.order - b.order).map((img, i) => (
                <div key={img.id} className="admin-image-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={`Product image ${i + 1}`} />
                </div>
              ))}
              {current.images.length === 0 && <p style={{ fontSize: 12, color: "var(--admin-muted)" }}>No images.</p>}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

// ─── Product Manager ──────────────────────────────────────────────────────────

function ProductManager({
  categories,
  canEdit,
}: {
  categories: Category[];
  canEdit: boolean;
}) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [cursors, setCursors] = useState<string[]>([""]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Create form state
  const [cTitle, setCTitle] = useState("");
  const [cBrand, setCBrand] = useState("");
  const [cCategoryId, setCCategoryId] = useState("");
  const [cDescription, setCDescription] = useState("");
  const [cFoodType, setCFoodType] = useState("");
  const [cTaxRate, setCTaxRate] = useState("0");
  const [cHsnCode, setCHsnCode] = useState("");
  const [createError, setCreateError] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  // Deleting state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const cursor = cursors.at(-1)!;

  function flatten(cats: Category[], acc: Category[] = []): Category[] {
    for (const c of cats) { acc.push(c); if (c.children) flatten(c.children, acc); }
    return acc;
  }
  const flatCats = flatten(categories);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams({ limit: "25", ...(query && { q: query }), ...(catFilter && { categoryId: catFilter }), ...(statusFilter && { status: statusFilter }), ...(cursor && { cursor }) });
    api<{ data: ProductRow[]; meta: { nextCursor: string | null } }>(`products?${params}`, { signal: controller.signal })
      .then((body) => { if (!controller.signal.aborted) { setProducts(body.data); setNextCursor(body.meta.nextCursor); } })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Products could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, catFilter, statusFilter, cursor, attempt]);

  function search(e: FormEvent) {
    e.preventDefault();
    setCursors([""]); setQuery(q); setAttempt((v) => v + 1);
  }

  async function openDetail(id: string) {
    setDetailId(id); setLoadingDetail(true); setDetailProduct(null);
    try {
      const body = await api<{ data: Product }>(`products/${id}`);
      setDetailProduct(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Product could not be loaded.");
      setDetailId(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function archiveRestore(id: string, currentStatus: string) {
    const action = currentStatus === "active" ? "archive" : "restore";
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`products/${id}/${action}`, { method: "POST", headers: { "X-CSRF-Token": "1" } });
      setNotice(`Product ${action}d.`);
      setAttempt((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function hardDelete(id: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`products/${id}`, { method: "DELETE", headers: { "X-CSRF-Token": "1" } });
      setDeletingId(null);
      setNotice("Product deleted.");
      setAttempt((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createProduct(e: FormEvent) {
    e.preventDefault();
    setCreateBusy(true); setCreateError("");
    try {
      const body = await api<{ data: { id: string } }>("products", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify({ title: cTitle, brand: cBrand, categoryId: cCategoryId || undefined, description: cDescription, foodType: cFoodType || undefined, taxRate: parseFloat(cTaxRate) || 0, hsnCode: cHsnCode }),
      });
      setCreating(false);
      setNotice("Product created.");
      setAttempt((v) => v + 1);
      void openDetail(body.data.id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Product could not be created.");
    } finally {
      setCreateBusy(false);
    }
  }

  // Show detail panel
  if (detailId) {
    if (loadingDetail) return <p role="status">Loading product…</p>;
    if (!detailProduct) return null;
    return (
      <ProductDetail
        product={detailProduct}
        categories={categories}
        canEdit={canEdit}
        onBack={() => { setDetailId(null); setDetailProduct(null); }}
        onChanged={(updated) => setDetailProduct(updated)}
      />
    );
  }

  return (
    <>
      <div className="admin-heading" style={{ marginBottom: 20 }}>
        <div>
          <h1>Products</h1>
          <p>Search and manage the master product catalog.</p>
        </div>
        <div className="admin-role-actions" style={{ padding: 0 }}>
          <button className="admin-text-button" disabled={loading || busy} onClick={() => setAttempt((v) => v + 1)}>Reload</button>
          {canEdit && <button className="admin-role-button" disabled={busy} onClick={() => { setCreating(!creating); setCreateError(""); }}>
            {creating ? "Cancel" : "Create product"}
          </button>}
        </div>
      </div>

      {notice && <p role="status" style={{ color: "#137333", marginBottom: 12 }}>{notice}</p>}
      {error && <p role="alert" className="admin-role-error" style={{ marginBottom: 12 }}>{error}</p>}

      {creating && (
        <form className="admin-panel admin-role-form" onSubmit={createProduct} style={{ marginBottom: 20 }}>
          <h2>Create product</h2>
          <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
            <label htmlFor="cp-title">Title *
              <input id="cp-title" required maxLength={240} value={cTitle} disabled={createBusy} onChange={(e) => setCTitle(e.target.value)}
                style={{ display: "block", marginTop: 6, width: "100%", padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }} />
            </label>
            <label htmlFor="cp-brand">Brand
              <input id="cp-brand" maxLength={120} value={cBrand} disabled={createBusy} onChange={(e) => setCBrand(e.target.value)}
                style={{ display: "block", marginTop: 6, width: "100%", padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }} />
            </label>
            <label htmlFor="cp-cat">Category
              <select id="cp-cat" value={cCategoryId} disabled={createBusy} onChange={(e) => setCCategoryId(e.target.value)}
                style={{ display: "block", marginTop: 6, width: "100%", padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }}>
                <option value="">— Uncategorised —</option>
                {flatCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <div style={{ display: "flex", gap: 12 }}>
              <label style={{ flex: 1 }}>Food type
                <select value={cFoodType} disabled={createBusy} onChange={(e) => setCFoodType(e.target.value)}
                  style={{ display: "block", marginTop: 6, width: "100%", padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }}>
                  <option value="">Not specified</option>
                  <option value="veg">Vegetarian</option>
                  <option value="non_veg">Non-vegetarian</option>
                  <option value="egg">Egg</option>
                </select>
              </label>
              <label style={{ width: 120 }}>Tax rate (%)
                <input type="number" min="0" max="100" step="0.01" value={cTaxRate} disabled={createBusy} onChange={(e) => setCTaxRate(e.target.value)}
                  style={{ display: "block", marginTop: 6, width: "100%", padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }} />
              </label>
              <label style={{ width: 140 }}>HSN code
                <input maxLength={20} value={cHsnCode} disabled={createBusy} onChange={(e) => setCHsnCode(e.target.value)}
                  style={{ display: "block", marginTop: 6, width: "100%", padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }} />
              </label>
            </div>
            <label htmlFor="cp-desc">Description
              <textarea id="cp-desc" maxLength={2000} value={cDescription} disabled={createBusy} onChange={(e) => setCDescription(e.target.value)}
                style={{ display: "block", marginTop: 6, width: "100%", minHeight: 80, padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit", resize: "vertical" }} />
            </label>
          </div>
          {createError && <p role="alert" className="admin-role-error" style={{ marginTop: 10 }}>{createError}</p>}
          <div className="admin-role-actions" style={{ marginTop: 16, padding: 0 }}>
            <button className="admin-role-button" type="submit" disabled={createBusy}>{createBusy ? "Creating…" : "Create product"}</button>
            <button type="button" disabled={createBusy} onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </form>
      )}

      <section className="admin-panel" aria-labelledby="products-title">
        <form className="admin-staff-filters" onSubmit={search}>
          <label>Search products
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={120} />
          </label>
          <label>Category
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
              <option value="">All categories</option>
              {flatCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <button className="admin-role-button" disabled={loading || busy}>Apply filters</button>
        </form>
        <div className="admin-panel-toolbar">
          <h2 id="products-title">Products</h2>
          <span>{loading ? "Loading…" : `${products.length} shown`}</span>
        </div>
        {loading ? (
          <p className="admin-roles-message" role="status">Loading products…</p>
        ) : error ? (
          <p className="admin-roles-message" role="alert">{error}</p>
        ) : products.length === 0 ? (
          <p className="admin-roles-message">No products match these filters.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="admin-product-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Brand</th>
                  <th>Category</th>
                  <th>Variants</th>
                  <th>Status</th>
                  {canEdit && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const catName = flatCats.find((c) => c.id === p.categoryId)?.name ?? "—";
                  return (
                    <tr key={p.id}>
                      <td>
                        <button className="admin-text-button" style={{ padding: 0, textAlign: "left", fontWeight: 600 }} onClick={() => openDetail(p.id)}>{p.title}</button>
                      </td>
                      <td style={{ color: "var(--admin-muted)" }}>{p.brand || "—"}</td>
                      <td style={{ color: "var(--admin-muted)" }}>{catName}</td>
                      <td>{p.variantCount ?? "—"}</td>
                      <td><span className={`admin-badge ${p.status === "active" ? "admin-badge-active" : "admin-badge-disabled"}`}>{p.status}</span></td>
                      {canEdit && (
                        <td>
                          <div className="admin-role-actions" style={{ padding: 0, gap: 6 }}>
                            {deletingId === p.id ? (
                              <>
                                <span style={{ fontSize: 12 }}>Delete permanently?</span>
                                <button disabled={busy} onClick={() => hardDelete(p.id)} style={{ border: "1px solid #bacbbd", borderRadius: 6, padding: "4px 8px", background: "#fff", cursor: "pointer", fontSize: 12, color: "#a73535" }}>{busy ? "…" : "Confirm"}</button>
                                <button disabled={busy} onClick={() => setDeletingId(null)} style={{ border: "1px solid #bacbbd", borderRadius: 6, padding: "4px 8px", background: "#fff", cursor: "pointer", fontSize: 12 }}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <button disabled={busy} onClick={() => archiveRestore(p.id, p.status)} style={{ border: "1px solid #bacbbd", borderRadius: 6, padding: "4px 8px", background: "#fff", cursor: "pointer", fontSize: 12 }}>
                                  {p.status === "active" ? "Archive" : "Restore"}
                                </button>
                                {p.status === "archived" && (
                                  <button disabled={busy} onClick={() => setDeletingId(p.id)} style={{ border: "1px solid #bacbbd", borderRadius: 6, padding: "4px 8px", background: "#fff", cursor: "pointer", fontSize: 12, color: "#a73535" }}>Delete</button>
                                )}
                              </>
                            )}
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
        <div className="admin-staff-pagination">
          <button disabled={loading || cursors.length <= 1} onClick={() => setCursors((v) => v.slice(0, -1))}>Previous</button>
          <span>Page {cursors.length}</span>
          <button disabled={loading || !nextCursor} onClick={() => { if (nextCursor) setCursors((v) => [...v, nextCursor]); }}>Next</button>
        </div>
      </section>
    </>
  );
}

// ─── Catalog Export ───────────────────────────────────────────────────────────

function CatalogExport() {
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setBusy(true); setError("");
    try {
      const res = await adminFetch(`/api/v1/admin/catalog/export?format=${format}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: { message?: string } }).error?.message ?? "Export failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `catalog-export.${format}`;
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
          <p>Download the full master catalog as CSV or JSON.</p>
        </div>
      </div>
      <section className="admin-panel" aria-labelledby="export-title" style={{ maxWidth: 480 }}>
        <div className="admin-panel-toolbar"><h2 id="export-title">Download</h2></div>
        <div style={{ padding: 24, display: "grid", gap: 16 }}>
          <label htmlFor="export-format" style={{ fontSize: 12, fontWeight: 600 }}>Format
            <select id="export-format" value={format} onChange={(e) => setFormat(e.target.value as "csv" | "json")} disabled={busy}
              style={{ display: "block", marginTop: 6, width: "100%", padding: 10, border: "1px solid #bacbbd", borderRadius: 6, font: "inherit" }}>
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </label>
          {error && <p role="alert" className="admin-role-error">{error}</p>}
          <button className="admin-role-button" onClick={download} disabled={busy}>{busy ? "Exporting…" : `Download ${format.toUpperCase()}`}</button>
        </div>
      </section>
    </>
  );
}

// ─── Root Catalog Component ───────────────────────────────────────────────────

type Tab = "categories" | "products" | "export";

export default function Catalog({ session }: { session: AdminSession }) {
  const [tab, setTab] = useState<Tab>("categories");
  const [categories, setCategories] = useState<Category[]>([]);

  const canEdit =
    session.user.permissions.includes("*") ||
    session.user.permissions.includes("catalog:manage");

  // Load categories once; shared across tabs (product form uses them)
  useEffect(() => {
    void api<{ data: Category[] }>("categories").then((body) => setCategories(body.data)).catch(() => {});
  }, []);

  return (
    <>
      <div className="admin-tab-nav" role="tablist" aria-label="Catalog sections">
        {(["categories", "products", "export"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "is-active" : ""}
            onClick={() => setTab(t)}
          >
            {t === "categories" ? "Categories" : t === "products" ? "Products & variants" : "Export"}
          </button>
        ))}
      </div>
      {tab === "categories" ? (
        <CategoryManager canEdit={canEdit} />
      ) : tab === "products" ? (
        <ProductManager categories={categories} canEdit={canEdit} />
      ) : (
        <CatalogExport />
      )}
    </>
  );
}
