"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { adminFetch } from "./session-client";

type Role = { id: string; name: string; isSystem: boolean };
type StaffAccount = { id: string; name: string; email: string | null; role: string; roleId: string; status: string;
  scope: { all: boolean; warehouseIds: string[] }; lastLoginAt: string | null };
async function api(path: string, init?: RequestInit) {
  const response = await adminFetch(`/api/v1/admin/${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "The request could not be completed.");
  return body;
}
function StaffEditor({ account, roles, self, onSaved, onCancel }: { account: StaffAccount | null; roles: Role[]; self: boolean; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(account?.name ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState(account?.roleId ?? roles[0]?.id ?? "");
  const [all, setAll] = useState(account?.scope.all ?? false);
  const [warehouses, setWarehouses] = useState(account?.scope.warehouseIds.join(", ") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const scope = { all, warehouseIds: all ? [] : warehouses.split(/[\s,]+/).filter(Boolean) };
      const body = account ? { name, ...(!self && { roleId, scope }) } : { name, email, password, roleId, scope };
      await api(`staff${account ? `/${account.id}` : ""}`, { method: account ? "PUT" : "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" }, body: JSON.stringify(body) });
      setPassword(""); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The staff account could not be saved."); }
    finally { setBusy(false); }
  }
  return <form className="admin-panel admin-role-form admin-staff-form" onSubmit={save} aria-busy={busy}>
    <h2 tabIndex={-1} ref={heading}>{account ? `Edit ${account.name}` : "Create staff account"}</h2>
    <label htmlFor="staff-name">Name</label><input id="staff-name" required maxLength={120} value={name} onChange={event => setName(event.target.value)} disabled={busy} />
    {!account && <><label htmlFor="staff-create-email">Email</label><input id="staff-create-email" type="email" autoComplete="off" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
      <label htmlFor="staff-create-password">Temporary password</label><input id="staff-create-password" type="password" autoComplete="new-password" required minLength={10} maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /><p>Use at least 10 characters. The staff member must change it at first sign-in.</p></>}
    <label htmlFor="staff-role">{roles.length ? "Role" : "Role ID"}</label>{roles.length ? <select id="staff-role" required value={roleId} onChange={event => setRoleId(event.target.value)} disabled={busy || self}>{roles.map(role => <option key={role.id} value={role.id}>{role.name.replaceAll("_", " ")}</option>)}</select>
      : <input id="staff-role" required pattern="[a-fA-F0-9]{24}" value={roleId} onChange={event => setRoleId(event.target.value)} disabled={busy || self} />}
    <fieldset disabled={busy || self}><legend>Warehouse access</legend><label><input type="checkbox" checked={all} onChange={event => setAll(event.target.checked)} />All warehouses</label>
      {!all && <><label htmlFor="staff-warehouses">Warehouse IDs</label><textarea id="staff-warehouses" value={warehouses} onChange={event => setWarehouses(event.target.value)} aria-describedby="staff-warehouse-help" maxLength={2600} /><p id="staff-warehouse-help">Separate existing warehouse IDs with commas. Leave empty to grant no warehouse access.</p></>}
    </fieldset>{self && <p>Your role and warehouse access must be changed by another administrator.</p>}
    {error && <p role="alert" className="admin-role-error">{error}</p>}
    <div className="admin-role-actions"><button className="admin-role-button" disabled={busy}>{busy ? "Saving…" : "Save staff account"}</button><button type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>;
}
export default function Staff({ userId, onSignOut }: { userId: string; onSignOut: () => void }) {
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [roleId, setRoleId] = useState("");
  const [query, setQuery] = useState("");
  const [cursors, setCursors] = useState<string[]>([""]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<StaffAccount | "new" | null>(null);
  const [action, setAction] = useState<{ account: StaffAccount; operation: string } | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const cursor = cursors.at(-1)!;
  useEffect(() => {
    let active = true;
    void api("roles").then(body => { if (active) setRoles(body.data.filter((role: Role) => !["super_admin", "customer", "rider"].includes(role.name))); }, () => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    void api(`staff?limit=25${query}${cursor ? `&cursor=${cursor}` : ""}`, { signal: controller.signal }).then(body => {
      if (!controller.signal.aborted) { setAccounts(body.data); setNextCursor(body.meta.nextCursor); }
    }, cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Staff could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, cursor, attempt]);
  function search(event: FormEvent) { event.preventDefault(); setCursors([""]); setQuery(`&${new URLSearchParams({ ...(q && { q }), ...(status && { status }), ...(roleId && { roleId }) })}`); setAttempt(value => value + 1); }
  async function confirmAction(event: FormEvent) {
    event.preventDefault(); if (!action) return; setBusy(true); setError(""); setNotice("");
    try {
      await api(`staff/${action.account.id}/${action.operation}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        body: JSON.stringify(action.operation === "reset-password" ? { newPassword: temporaryPassword } : {}) });
      if (action.account.id === userId && ["reset-password", "force-logout"].includes(action.operation)) { onSignOut(); return; }
      setAction(null); setTemporaryPassword(""); setNotice("Staff account updated."); setAttempt(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The action could not be confirmed. Reload before retrying."); }
    finally { setBusy(false); }
  }
  return <><div className="admin-heading"><div><h1>Staff</h1><p>Manage your team’s access and account security.</p></div><button className="admin-role-button" disabled={busy} onClick={() => { setEditor("new"); setAction(null); setError(""); }}>Create staff account</button></div>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="admin-role-error">{error}</p>}
    {editor && <StaffEditor key={editor === "new" ? "new" : editor.id} account={editor === "new" ? null : editor} roles={roles} self={editor !== "new" && editor.id === userId} onSaved={() => { setEditor(null); setNotice("Staff account saved."); setAttempt(value => value + 1); }} onCancel={() => setEditor(null)} />}
    {action && <form className="admin-panel admin-role-form admin-staff-confirm" onSubmit={confirmAction} aria-busy={busy}>
      <h2>{action.operation.replaceAll("-", " ")} · {action.account.name}</h2>
      <p>{action.operation === "reactivate" ? "This restores sign-in access. Previous sessions stay revoked." : action.operation === "deactivate" ? "This blocks sign-in and ends every active session." : action.operation === "reset-password" ? "The staff member must change the new temporary password. Every session will end." : "Every active session for this staff member will end."}</p>
      {action.operation === "reset-password" && <><label htmlFor="staff-reset-password">New temporary password</label><input id="staff-reset-password" type="password" autoComplete="new-password" minLength={10} maxLength={1024} required value={temporaryPassword} onChange={event => setTemporaryPassword(event.target.value)} disabled={busy} /></>}
      <div className="admin-role-actions"><button className="admin-role-button" disabled={busy}>{busy ? "Updating…" : "Confirm action"}</button><button type="button" disabled={busy} onClick={() => { setAction(null); setTemporaryPassword(""); }}>Cancel</button></div>
    </form>}
    <section className="admin-panel" aria-labelledby="staff-list-title"><div className="admin-panel-toolbar"><h2 id="staff-list-title">Team accounts</h2><button className="admin-text-button" disabled={loading || busy} onClick={() => setAttempt(value => value + 1)}>Reload staff</button></div>
      <form className="admin-staff-filters" onSubmit={search}><label>Search staff<input type="search" value={q} onChange={event => setQ(event.target.value)} maxLength={120} /></label><label>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="deactivated">Deactivated</option></select></label>
        {roles.length > 0 && <label>Role<select value={roleId} onChange={event => setRoleId(event.target.value)}><option value="">All roles</option>{roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>}<button className="admin-role-button" disabled={loading || busy}>Apply filters</button></form>
      {loading ? <p className="admin-roles-message" role="status">Loading staff…</p> : error ? <p className="admin-roles-message">Reload staff to try again.</p> : !accounts.length ? <p className="admin-roles-message">No staff accounts match these filters.</p> : <div className="admin-staff-list">{accounts.map(account => <article key={account.id}>
        <div className="admin-staff-row"><div><h3>{account.name || "Unnamed staff"}</h3><p>{account.email ?? "Development account"}</p></div><div><strong>{account.role.replaceAll("_", " ")}</strong><span>{account.status}</span></div></div>
        <p className="admin-staff-scope">{account.scope.all ? "All warehouses" : account.scope.warehouseIds.length ? `${account.scope.warehouseIds.length} warehouse(s)` : "No warehouse access"} · Last sign-in: {account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString() : "Not yet"}</p>
        {account.role === "super_admin" ? <p className="admin-staff-scope">Protected owner account</p> : <div className="admin-role-actions"><button disabled={busy} onClick={() => { setEditor(account); setAction(null); }}>Edit account</button>{[account.status === "active" ? "deactivate" : "reactivate", "reset-password", "force-logout"].map(operation => <button key={operation} disabled={busy || (account.id === userId && operation === "deactivate")} onClick={() => { setAction({ account, operation }); setTemporaryPassword(""); setEditor(null); }}>{operation.replaceAll("-", " ")}</button>)}</div>}
      </article>)}</div>}
      <div className="admin-staff-pagination"><button disabled={loading || cursors.length <= 1} onClick={() => setCursors(values => values.slice(0, -1))}>Previous</button><span>Page {cursors.length}</span><button disabled={loading || !nextCursor} onClick={() => { if (nextCursor) setCursors(values => [...values, nextCursor]); }}>Next</button></div>
    </section></>;
}
