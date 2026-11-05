"use client";
import { useEffect, useState } from "react";
import { adminFetch } from "./session-client";

type Role = { id: string; name: string; permissions: string[]; isSystem: boolean };
type Result = { roles: Role[]; permissions: string[] };

export default function Roles() {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
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
  return <><div className="admin-heading"><div><h1>Roles &amp; permissions</h1><p>Review the roles and permissions configured for your store.</p></div></div>
    {error ? <div className="admin-panel admin-roles-message" role="alert"><p>{error}</p><button onClick={() => setAttempt(value => value + 1)}>Try again</button></div> : !data ? <p role="status">Loading roles…</p> : <>
      <section className="admin-panel" aria-labelledby="roles-title"><div className="admin-panel-toolbar"><h2 id="roles-title">Roles</h2><span>{data.roles.length} roles · Read only</span></div>
        {data.roles.length === 0 ? <p className="admin-roles-message">No roles found.</p> : <div className="admin-role-list">{data.roles.map(role => <details key={role.id}><summary><strong>{role.name.replaceAll("_", " ")}</strong><span>{role.isSystem ? "System role" : "Custom role"} · {role.permissions.includes("*") ? "All permissions" : `${role.permissions.length} permissions`}</span></summary><div className="admin-role-permissions">{role.permissions.length ? role.permissions.map(permission => <code key={permission}>{permission === "*" ? "All registered permissions" : permission}</code>) : <span>No permissions assigned.</span>}</div></details>)}</div>}
      </section><p className="admin-roles-footnote">{data.permissions.length} administrative permissions registered. Role changes and staff management are not available yet.</p></>}
  </>;
}
