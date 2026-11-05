import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { shutdown } from "../src/shutdown.js";

describe("graceful shutdown", () => {
  it("closes the listener before disconnecting the database", async () => {
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const disconnect = vi.fn(async () => { expect(server.listening).toBe(false); });
    await shutdown(server, disconnect);
    expect(disconnect).toHaveBeenCalledOnce();
  });
  it("fails if database disconnection exceeds the deadline", async () => {
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    await expect(shutdown(server, () => new Promise(() => {}), 20)).rejects.toThrow("Shutdown timed out");
  });
});
