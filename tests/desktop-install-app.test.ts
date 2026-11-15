import { describe, expect, test } from "bun:test";
import { installPlan, runningMiradorApps, runsFrom } from "../desktop/scripts/install-app.ts";

const BUILT = "/repo/desktop/build/stable-macos-arm64/Mirador.app";
const MINE = "/Users/me/Applications/Mirador.app";

const processes = [
  `58511 ${MINE}/Contents/MacOS/launcher`,
  `58512 ${MINE}/Contents/MacOS/bun`,
  "  700 /repo/desktop/build/dev-macos-arm64/Mirador-dev.app/Contents/MacOS/launcher",
  "  900 /opt/homebrew/bin/bun",
  "  800 /bin/zsh",
].join("\n");

describe("bun run app puts the build where Mirador runs from", () => {
  test("finds the running Mirador.app by its launcher, not its host or the dev build", () => {
    expect(runningMiradorApps(processes)).toEqual([MINE]);
  });

  test("an app runs from its bundle while its launcher or its host does, and not from a bundle whose path only ends the same", () => {
    expect(runsFrom(MINE, processes)).toBe(true);
    expect(runsFrom(MINE, processes.split("\n").filter((line) => !line.includes("launcher")).join("\n"))).toBe(true);
    expect(runsFrom("/Applications/Mirador.app", processes)).toBe(false);
    expect(runsFrom(MINE, "  800 /bin/zsh")).toBe(false);
  });

  test("a running app gets the build once it is quit, and one running from the build only opens again", () => {
    expect(installPlan(BUILT, [MINE], ["/Applications/Mirador.app"])).toEqual({ kind: "after-quit", target: MINE, copies: true });
    expect(installPlan(BUILT, [BUILT], [])).toEqual({ kind: "after-quit", target: BUILT, copies: false });
  });

  test("with none running it replaces the installed app at once, and with none installed it leaves the build where it is", () => {
    expect(installPlan(BUILT, [], [MINE, "/Applications/Mirador.app"])).toEqual({ kind: "now", target: MINE });
    expect(installPlan(BUILT, [], [])).toEqual({ kind: "nowhere" });
  });
});
