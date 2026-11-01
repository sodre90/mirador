#!/usr/bin/env bun
/**
 * Serves a folder of update files over HTTP and logs every request, standing in for the release a desktop app fetches
 * its updates from. Used by scripts/linux-desktop.sh, which checks from the log that the app took the patch rather than
 * the whole archive. Usage: update-test-server.ts <folder> <port> <log>
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const [folder, port, log] = process.argv.slice(2);
if (!folder || !port || !log) throw new Error("Usage: update-test-server.ts <folder> <port> <log>");

Bun.serve({
  hostname: "127.0.0.1",
  port: Number(port),
  async fetch(request) {
    const asked = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
    const file = Bun.file(join(folder, asked));
    const found = (await file.exists()) && !asked.includes("..");
    appendFileSync(log, `${found ? 200 : 404} ${asked}${found ? ` ${file.size}` : ""}\n`);
    return found ? new Response(file) : new Response("not found", { status: 404 });
  },
});
console.log(`serving ${folder} on 127.0.0.1:${port}`);
