import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { afterAll, describe, expect, it } from "vitest";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}
function start(uri: string, port: number, env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, ["dist/server.js"], {
    cwd: process.cwd(), env: { ...process.env, MONGODB_URI: uri, PORT: String(port), ...env }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout!.on("data", chunk => { output += chunk.toString(); });
  child.stderr!.on("data", chunk => { output += chunk.toString(); });
  const exit = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  return { child, exit, output: () => output };
}
async function waitForReady(child: ChildProcess, port: number) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("API exited before readiness");
    try { if ((await fetch(`http://127.0.0.1:${port}/api/v1/ready`)).ok) return; } catch { /* not listening yet */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("API did not become ready");
}

describe("API process lifecycle", () => {
  let mongo: MongoMemoryReplSet | undefined;
  afterAll(async () => { await mongo?.stop(); });

  it("does not listen when the database cannot be reached", async () => {
    const dbPort = await freePort();
    const apiPort = await freePort();
    const api = start(`mongodb://127.0.0.1:${dbPort}/isolated_test`, apiPort);
    expect(await api.exit).toBe(1);
    expect(api.output()).toContain("database_connection_failed");
    expect(api.output()).not.toContain("server_listening");
    await expect(fetch(`http://127.0.0.1:${apiPort}/api/v1/health`)).rejects.toThrow();
  }, 15000);

  it("reports ready against a disposable replica set", async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const port = await freePort();
    const api = start(mongo.getUri("isolated_test"), port);
    try {
      await waitForReady(api.child, port);
      expect((await fetch(`http://127.0.0.1:${port}/api/v1/ready`)).status).toBe(200);
    } finally {
      if (api.child.exitCode === null && api.child.signalCode === null) api.child.kill("SIGKILL");
      await api.exit;
      await mongo.stop();
      mongo = undefined;
    }
  }, 120000);

  it.skipIf(process.platform === "win32")("serves readiness and closes cleanly on SIGTERM", async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const port = await freePort();
    const api = start(mongo.getUri("isolated_test"), port);
    try {
      await waitForReady(api.child, port);
      expect(api.child.kill("SIGTERM")).toBe(true);
      expect(await api.exit).toBe(0);
      expect(api.output()).toContain("shutdown_complete");
      await expect(fetch(`http://127.0.0.1:${port}/api/v1/health`)).rejects.toThrow();
    } finally {
      if (api.child.exitCode === null && api.child.signalCode === null) api.child.kill("SIGKILL");
    }
  }, 120000);

  it("registers guarded F02 routes in production without exposing mock login", async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const port = await freePort();
    const api = start(mongo.getUri("administration_test"), port, { NODE_ENV: "production", mockOTP: "false", JWT_SECRET: "b".repeat(64), STAFF_TOTP_KEY: "c".repeat(64) });
    try {
      await waitForReady(api.child, port);
      for (const path of ["/admin/staff", "/admin/roles", "/admin/permissions"]) {
        expect((await fetch(`http://127.0.0.1:${port}/api/v1${path}`)).status).toBe(401);
      }
      expect((await fetch(`http://127.0.0.1:${port}/api/v1/auth/request-otp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: "9000000001" }) })).status).toBe(404);
    } finally {
      if (api.child.exitCode === null && api.child.signalCode === null) api.child.kill("SIGKILL");
      await api.exit;
      await mongo.stop();
      mongo = undefined;
    }
  }, 120000);
});
