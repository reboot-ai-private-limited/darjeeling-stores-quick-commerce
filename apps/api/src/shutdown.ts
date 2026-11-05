import type { Server } from "node:http";

export async function shutdown(server: Server, disconnect: () => Promise<void>, timeoutMs = 10000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        await disconnect();
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Shutdown timed out")), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
