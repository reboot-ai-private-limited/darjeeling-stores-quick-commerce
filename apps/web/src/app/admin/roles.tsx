"use client";
import { useEffect, useState, type FormEvent } from "react";
import { adminFetch } from "./session-client";

type Role = { id: string; name: string; permissions: string[]; isSystem: boolean };
type Result = { roles: Role[]; permissions: string[] };

export default function Roles() {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const [name, setName] = useState("");
  const [grants, setGrants] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError(""); setData(null);
    async function load() {
      try {
        const [roles, permissions] = await Promise.all([adminFetch("/api/v1/admin/roles", { signal: controller.signal }), adminFetch("/api/v1/admin/permissions", { signal: controller.signal })]);
        if (roles.status === 401 || permissions.status === 401) throw new Error("Your session has expired. Sign out and sign in again.");
        if (roles.status === 403 || permissions.status === 403) throw new Error("You do not have permission to view roles.");
        if (!roles.ok || !permissions.ok) throw new Error("Roles could not be loaded. Please try again.");
        const [roleBody, permissionBody] = await Promise.all([roles.json(), permissions.json()]);
        if (!Array.isArray(roleBody.data) || !Array.isArray(permissionBody.data?.admin)) throw new Error("The server returned an invalid response.");
        setData({ roles: roleBody.data, permissions: permissionBody.data.admin });
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Roles could not be loaded."); }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);
  function edit(role: Role | "new") {
    setEditing(role); setName(role === "new" ? "" : role.name); setGrants(role === "new" ? [] : [...role.permissions]); setMutationError(""); setDeleting(null);
  }
  async function mutate(method: "POST" | "PUT" | "DELETE", role?: Role) {
    setBusy(true); setMutationError("");
    try {
      const response = await adminFetch(`/api/v1/admin/roles${role ? `/${role.id}` : ""}`, {
        method, headers: { "Content-Type": "application/json", "X-CSRF-Token": "1" },
        ...(method !== "DELETE" && { body: JSON.stringify({ ...(method === "POST" && { name }), permissions: grants }) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "The role could not be changed.");
      setEditing(null); setDeleting(null); setAttempt(value => value + 1);
    } catch (cause) { setMutationError(cause instanceof TypeError ? "The request could not be confirmed. Reload roles before retrying." : cause instanceof Error ? cause.message : "The role could not be changed."); }
    finally { setBusy(false); }
  }
  function save(event: FormEvent) { event.preventDefault(); if (editing) void mutate(editing === "new" ? "POST" : "PUT", editing === "new" ? undefined : editing); }
  return <><div className="admin-heading"><div><h1>Roles &amp; permissions</h1><p>Manage the permissions available to your team.</p></div>{data && <div className="admin-role-actions"><button disabled={busy} onClick={() => { setEditing(null); setDeleting(null); setAttempt(value => value + 1); }}>Reload roles</button><button className="admin-role-button" disabled={busy} onClick={() => edit("new")}>Create role</button></div>}</div>
    {mutationError && <p className="admin-role-error" role="alert">{mutationError}</p>}
    {error ? <div className="admin-panel admin-roles-message" role="alert"><p>{error}</p><button onClick={() => setAttempt(value => value + 1)}>Try again</button></div> : !data ? <p role="status">Loading roles…</p> : <>
      {editing && <form className="admin-panel admin-role-form" onSubmit={save} aria-label={editing === "new" ? "Create role" : "Edit role"}>
        <h2>{editing === "new" ? "Create role" : `Edit ${editing.name}`}</h2>
        <label htmlFor="role-name">Role name</label><input id="role-name" value={name} onChange={event => setName(event.target.value)} required pattern="[a-z][a-z0-9_]{0,63}" maxLength={64} disabled={busy || editing !== "new"} aria-describedby="role-name-help" />
        <p id="role-name-help">Use lowercase letters, numbers and underscores. Names cannot be changed later.</p>
        <fieldset disabled={busy}><legend>Permissions</legend><div className="admin-role-choices">{data.permissions.map(permission => <label key={permission}><input type="checkbox" checked={grants.includes(permission)} onChange={event => setGrants(previous => event.target.checked ? [...previous, permission] : previous.filter(key => key !== permission))} />{permission}</label>)}</div></fieldset>
        <div className="admin-role-actions"><button className="admin-role-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save role"}</button><button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button></div>
      </form>}
      <section className="admin-panel" aria-labelledby="roles-title"><div className="admin-panel-toolbar"><h2 id="roles-title">Roles</h2><span>{data.roles.length} roles</span></div>
        {data.roles.length === 0 ? <p className="admin-roles-message">No roles found.</p> : <div className="admin-role-list">{data.roles.map(role => <details key={role.id}><summary><strong>{role.name.replaceAll("_", " ")}</strong><span>{role.isSystem ? "System role" : "Custom role"} · {role.permissions.includes("*") ? "All permissions" : `${role.permissions.length} permissions`}</span></summary><div className="admin-role-permissions">{role.permissions.length ? role.permissions.map(permission => <code key={permission}>{permission === "*" ? "All registered permissions" : permission}</code>) : <span>No permissions assigned.</span>}</div>
          {!role.isSystem && <div className="admin-role-actions"><button disabled={busy} onClick={() => edit(role)}>Edit permissions</button>{deleting === role.id ? <><span>Delete {role.name}? This cannot be undone.</span><button disabled={busy} onClick={() => void mutate("DELETE", role)}>Confirm delete</button><button disabled={busy} onClick={() => setDeleting(null)}>Cancel</button></> : <button disabled={busy} onClick={() => { setDeleting(role.id); setEditing(null); setMutationError(""); }}>Delete role</button>}</div>}
        </details>)}</div>}
      </section><p className="admin-roles-footnote">System roles are protected. Assigned roles cannot be deleted. Permission changes apply to the next request.</p></>}
  </>;
}
