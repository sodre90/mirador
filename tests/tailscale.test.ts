import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { servePortOnTailnet, tailnetName, tailscaleCommand } from "../host/tailscale.ts";
import { fakeProgram } from "./fake-program.ts";

let directory: string;
let calls: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "mirador-tailscale-"));
  calls = join(directory, "calls");
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

/** Stands in for the Tailscale command, printing what the test wants and recording how it was called. */
function tailscaleSaying(stdout: string, exitCode = 0) {
  return fakeProgram(
    directory,
    "tailscale",
    `require("node:fs").appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(" ") + "\\n"); console.log(${JSON.stringify(stdout)}); process.exit(${exitCode});`,
  );
}

const called = () => readFileSync(calls, "utf8").trim().split("\n");

test("this machine's name on the tailnet comes from Tailscale's own status", async () => {
  const command = tailscaleSaying(JSON.stringify({ Self: { DNSName: "macbook.example.ts.net." } }));
  expect(await tailnetName(command)).toBe("macbook.example.ts.net");
  expect(called()).toEqual(["status --json"]);
});

test("a machine that is not signed in, or says something else, has no name", async () => {
  expect(await tailnetName(tailscaleSaying("", 1))).toBeNull();
  expect(await tailnetName(tailscaleSaying("not json"))).toBeNull();
  expect(await tailnetName(tailscaleSaying(JSON.stringify({ Self: {} })))).toBeNull();
});

test("a port is served on the tailnet under its own number, so the address is predictable", async () => {
  const command = tailscaleSaying("");
  expect(await servePortOnTailnet(command, 4601)).toBeNull();
  expect(called()).toEqual(["serve --bg --https=4601 http://127.0.0.1:4601"]);
});

test("what Tailscale said about a failed serve is handed back, so Settings can show it", async () => {
  const command = tailscaleSaying("serve: access denied: cannot serve on port 4601", 1);
  expect(await servePortOnTailnet(command, 4601)).toEqual({ problem: "serve: access denied: cannot serve on port 4601" });
});

test("the command Mirador runs is the one the environment names, and no other", () => {
  const command = tailscaleSaying("");
  expect(tailscaleCommand({ MIRADOR_TAILSCALE: command })).toBe(command);
  expect(tailscaleCommand({ MIRADOR_TAILSCALE: join(directory, "absent") })).toBeNull();
});
