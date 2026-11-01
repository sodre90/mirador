import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { agentEnvironment, miradorCommandEnvironment } from "../host/acp/environment.ts";

const temporaryMiradorHolding = (files: string[]) => {
  const checkout = mkdtempSync(join(tmpdir(), "mirador-checkout-"));
  for (const file of ["bin/mirador", ...files]) {
    mkdirSync(join(checkout, file, ".."), { recursive: true });
    writeFileSync(join(checkout, file), "");
  }
  return checkout;
};

const outerCheckout = temporaryMiradorHolding(["host/cli.ts"]);
const standaloneCommands = temporaryMiradorHolding([]);
const projectLaidOutLikeMirador = mkdtempSync(join(tmpdir(), "project-"));
for (const file of ["bin/tool", "host/cli.ts"]) {
  mkdirSync(join(projectLaidOutLikeMirador, file, ".."), { recursive: true });
  writeFileSync(join(projectLaidOutLikeMirador, file), "");
}

afterAll(() => {
  rmSync(outerCheckout, { recursive: true, force: true });
  rmSync(standaloneCommands, { recursive: true, force: true });
  rmSync(projectLaidOutLikeMirador, { recursive: true, force: true });
});

test("the variables of a session the host was started from stay out of its agents and terminals", () => {
  const inherited = {
    PATH: "/usr/bin",
    MIRADOR_PORT: "4700",
    CMUX_SURFACE_ID: "surface",
    CLAUDE_CODE_SESSION_ID: "outer-session",
    PI_SESSION_ID: "outer-pi-session",
    PI_SESSION_FILE: "/outer/session.jsonl",
    MIRADOR_URL: "http://127.0.0.1:4600",
    MIRADOR_SCRIPT_TOKEN: "outer-token",
    CLAUDE_CODE_EXECUTABLE: "/outer/claude",
  };
  expect(agentEnvironment(inherited)).toEqual({ PATH: "/usr/bin", MIRADOR_PORT: "4700" });
});

test.if(process.platform === "win32")("on Windows the agent's PATH is named PATH, whatever case Windows gives it", () => {
  const environment = agentEnvironment({ Path: "C:\\Windows\\System32" });
  expect(environment).toEqual({ PATH: "C:\\Windows\\System32" });
  expect(miradorCommandEnvironment(environment.PATH).PATH).toStartWith("C:\\Windows\\System32;");
});

test("the mirador command comes last on the agent's PATH, once", () => {
  const environment = miradorCommandEnvironment(["/usr/bin", "/bin"].join(delimiter));
  expect(environment.PATH).toBe(["/usr/bin", "/bin", join(import.meta.dir, "..", "bin")].join(delimiter));
  expect(miradorCommandEnvironment(environment.PATH).PATH).toBe(environment.PATH);
});

test("another Mirador's command folder comes off the agent's PATH", () => {
  const environment = miradorCommandEnvironment(["/usr/bin", join(outerCheckout, "bin"), "/bin"].join(delimiter));
  expect(environment.PATH).toBe(["/usr/bin", "/bin", join(import.meta.dir, "..", "bin")].join(delimiter));
});

test("an empty or relative entry keeps its place on the agent's PATH, whatever folder the host runs in", () => {
  const hostFolder = process.cwd();
  process.chdir(join(outerCheckout, "bin"));
  try {
    const environment = miradorCommandEnvironment(["", "/usr/bin", ".", "/bin"].join(delimiter));
    expect(environment.PATH).toBe(["", "/usr/bin", ".", "/bin", join(import.meta.dir, "..", "bin")].join(delimiter));
    expect(miradorCommandEnvironment("").PATH).toBe(join(import.meta.dir, "..", "bin"));
  } finally {
    process.chdir(hostFolder);
  }
});

test("a mirador with no host/cli.ts beside it keeps its place on the agent's PATH", () => {
  const environment = miradorCommandEnvironment(["/usr/bin", join(standaloneCommands, "bin"), "/bin"].join(delimiter));
  expect(environment.PATH).toBe(
    ["/usr/bin", join(standaloneCommands, "bin"), "/bin", join(import.meta.dir, "..", "bin")].join(delimiter),
  );
});

test("the mirador command runs on the host's Bun, also where no Bun is on the PATH", () => {
  const environment = miradorCommandEnvironment(["/usr/bin", "/bin"].join(delimiter));
  const help = spawnSync("mirador", ["--help"], { env: { ...environment, HOME: "/nonexistent" }, encoding: "utf8" });
  expect(help.stderr).not.toContain("Bun not found");
  expect(help.status).toBe(0);
});

test("a folder of the user's own beside a host/cli.ts, with no mirador in it, keeps its place on the agent's PATH", () => {
  const environment = miradorCommandEnvironment(["/usr/bin", join(projectLaidOutLikeMirador, "bin"), "/bin"].join(delimiter));
  expect(environment.PATH).toBe(
    ["/usr/bin", join(projectLaidOutLikeMirador, "bin"), "/bin", join(import.meta.dir, "..", "bin")].join(delimiter),
  );
});
