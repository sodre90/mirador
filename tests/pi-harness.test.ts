import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchEnvironment, loginCommand } from "../host/acp/harnesses.ts";
import type { Profile } from "../shared/model.ts";
import { fakeProgram } from "./fake-program.ts";

const scratch = () => mkdtempSync(join(tmpdir(), "pi-harness-"));
const profileWith = (environment: string) => ({ name: "pi", environment }) as Profile;

test("pi-acp is told which pi to run: the one on the profile's PATH, or the profile's own", () => {
  const directory = scratch();
  const pi = fakeProgram(directory, "pi", "");
  expect(launchEnvironment("pi", profileWith(`PATH='${directory}'`), "").PI_ACP_PI_COMMAND).toBe(pi);
  expect(launchEnvironment("pi", profileWith(`PATH='${directory}'\nPI_ACP_PI_COMMAND=/opt/work/pi`), "").PI_ACP_PI_COMMAND).toBe("/opt/work/pi");
});

test("pi-acp keeps its startup notes out of the conversation, unless the profile asks for them", () => {
  const directory = scratch();
  fakeProgram(directory, "pi", "");
  expect(launchEnvironment("pi", profileWith(`PATH='${directory}'`), "").PI_ACP_QUIET_STARTUP).toBe("true");
  expect(launchEnvironment("pi", profileWith(`PATH='${directory}'\nPI_ACP_QUIET_STARTUP=false`), "").PI_ACP_QUIET_STARTUP).toBe("false");
});

test("without pi, starting it says how to install it", () => {
  expect(() => launchEnvironment("pi", profileWith(`PATH='${scratch()}'`), "")).toThrow(
    "pi is not installed: no pi executable on PATH. Install it with npm install -g @earendil-works/pi-coding-agent.",
  );
});

test("signing in to pi opens pi itself, where /login signs in", () => {
  const command = loginCommand("pi", { PI_ACP_PI_COMMAND: "/opt/work/pi" }, { kind: "posix", program: "/bin/sh" });
  expect(command.slice(-2)).toEqual(["mirador-login", "/opt/work/pi"]);
});
