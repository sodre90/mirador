import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackgroundHostAgent } from "../desktop/src/core/background-host.ts";
import { hostArgv } from "../desktop/src/core/host-command.ts";
import {
  hostAgentLabel,
  hostAgentPlist,
  launchAgentPath,
  launchctl,
  openAtLoginArgv,
  openAtLoginLabel,
  openAtLoginPlist,
} from "../desktop/src/core/launch-agents.ts";
import type { CommandRunner } from "../desktop/src/core/commands.ts";
import { LaunchAgent } from "../desktop/src/core/launchd.ts";
import { OpenAtLogin } from "../desktop/src/core/open-at-login.ts";
import { defaultSettings } from "../desktop/src/core/settings.ts";

const settings = defaultSettings({ hostDirectory: "/repo", bun: "/bun/bin/bun" });
const directories: string[] = [];

function scratchDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "mirador-launchd-"));
  directories.push(directory);
  return directory;
}

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

class FakeLaunchctl {
  calls: string[][] = [];
  loaded = false;

  run: CommandRunner = async (argv) => {
    this.calls.push(argv);
    const [, verb] = argv;
    if (verb === "print") return { exitCode: this.loaded ? 0 : 113, output: "" };
    if (verb === "bootstrap") this.loaded = true;
    if (verb === "bootout") this.loaded = false;
    return { exitCode: 0, output: "" };
  };

  verbs = () => this.calls.map(([, verb]) => verb).filter((verb) => verb !== "print");
}

describe("launch agent labels", () => {
  test("derive from the port so a dev build never meets the real app's agents", () => {
    expect(hostAgentLabel(4600)).toBe("com.sodre90.mirador.host.4600");
    expect(openAtLoginLabel(4600)).toBe("com.sodre90.mirador.open-at-login.4600");
    expect(hostAgentLabel(4790)).not.toBe(hostAgentLabel(4600));
    expect(openAtLoginLabel(4790)).not.toBe(openAtLoginLabel(4600));
  });

  test.skipIf(process.platform === "win32")("live in the user's LaunchAgents folder", () => {
    expect(launchAgentPath("/Users/me", "x.y")).toBe("/Users/me/Library/LaunchAgents/x.y.plist");
  });
});

describe("host launch agent plist", () => {
  const plist = hostAgentPlist({
    label: "x.host.4600",
    argv: hostArgv("/bin/zsh", "/bun/bin/bun", {}, "/repo"),
    workingDirectory: "/repo",
    logPath: "/data/logs/host.log",
  });

  test("starts the host through a login shell at load and keeps it alive", () => {
    expect(plist).toContain("<key>Label</key>\n  <string>x.host.4600</string>");
    expect(plist).toContain('<string>/bin/zsh</string>\n    <string>-ilc</string>\n    <string>cd -- "$0" &amp;&amp; exec "$@"</string>\n    <string>/repo</string>');
    expect(plist).toContain("<string>/bun/bin/bun</string>\n    <string>host/main.ts</string>");
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(plist).toContain("<key>KeepAlive</key>\n  <true/>");
    expect(plist).toContain("<key>WorkingDirectory</key>\n  <string>/repo</string>");
    expect(plist).toContain("<key>StandardOutPath</key>\n  <string>/data/logs/host.log</string>");
  });

  test("starts the host in fish's own syntax when the login shell is fish", () => {
    const fishPlist = hostAgentPlist({ label: "x.host.4600", argv: hostArgv("/opt/homebrew/bin/fish", "/bun/bin/bun", {}, "/repo"), workingDirectory: "/repo", logPath: "/data/logs/host.log" });
    expect(fishPlist).toContain("<string>-ilc</string>\n    <string>cd -- $argv[1] &amp;&amp; exec $argv[2..-1]</string>\n    <string>/repo</string>");
  });

  test("never carries environment values, and nothing at all for the real app's defaults", () => {
    expect(plist).not.toContain("EnvironmentVariables");
    expect(plist).not.toContain("MIRADOR_");
  });

  test("carries a dev port's overrides only as arguments", () => {
    const dev = hostAgentPlist({ label: "x", argv: hostArgv("/bin/zsh", "/bun", { MIRADOR_PORT: "4790" }, "/repo"), workingDirectory: "/repo", logPath: "/l" });
    expect(dev).toContain("<string>MIRADOR_PORT=4790</string>");
    expect(dev).not.toContain("EnvironmentVariables");
  });

  test("escapes XML in paths", () => {
    const tricky = hostAgentPlist({ label: "x", argv: ["/a&b/<bun>"], workingDirectory: "/r", logPath: "/l" });
    expect(tricky).toContain("<string>/a&amp;b/&lt;bun&gt;</string>");
  });
});

describe("open at login plist", () => {
  test("opens the app bundle at load", () => {
    const plist = openAtLoginPlist({ label: "x.login.4600", appPath: "/Applications/Mirador.app", overrides: {} });
    expect(plist).toContain("<string>/usr/bin/open</string>\n    <string>-a</string>\n    <string>/Applications/Mirador.app</string>");
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(plist).not.toContain("KeepAlive");
    expect(plist).not.toContain("MIRADOR_");
  });

  test("hands a dev port's overrides to the app with open's --env", () => {
    expect(openAtLoginArgv({ appPath: "/A.app", overrides: { MIRADOR_PORT: "4790", MIRADOR_DATA_DIR: "/s" } })).toEqual([
      "/usr/bin/open", "-a", "/A.app", "--env", "MIRADOR_PORT=4790", "--env", "MIRADOR_DATA_DIR=/s",
    ]);
  });
});

describe("launchctl commands", () => {
  test("target the user's gui domain", () => {
    expect(launchctl.bootstrap(501, "/p.plist")).toEqual(["launchctl", "bootstrap", "gui/501", "/p.plist"]);
    expect(launchctl.bootout(501, "x.y")).toEqual(["launchctl", "bootout", "gui/501/x.y"]);
    expect(launchctl.kickstart(501, "x.y")).toEqual(["launchctl", "kickstart", "-k", "gui/501/x.y"]);
    expect(launchctl.print(501, "x.y")).toEqual(["launchctl", "print", "gui/501/x.y"]);
  });
});

describe("launch agent service", () => {
  test("loads by bootstrapping the written plist and unloads then deletes it on uninstall", async () => {
    const launchd = new FakeLaunchctl();
    const plistPath = join(scratchDirectory(), "Library", "LaunchAgents", "x.y.plist");
    const agent = new LaunchAgent("x.y", plistPath, 501, launchd.run);

    agent.writePlist("<plist/>");
    await agent.bootstrap();
    expect(await agent.isLoaded()).toBe(true);
    expect(launchd.calls).toContainEqual(["launchctl", "bootstrap", "gui/501", plistPath]);

    await agent.uninstall();
    expect(launchd.verbs()).toEqual(["bootstrap", "bootout"]);
    expect(existsSync(plistPath)).toBe(false);
  });

  test("uninstalling an agent that was never loaded only deletes the file", async () => {
    const launchd = new FakeLaunchctl();
    const plistPath = join(scratchDirectory(), "x.y.plist");
    const agent = new LaunchAgent("x.y", plistPath, 501, launchd.run);
    agent.writePlist("<plist/>");
    await agent.uninstall();
    expect(launchd.verbs()).toEqual([]);
    expect(existsSync(plistPath)).toBe(false);
  });

  test("explains a failed launchctl call", async () => {
    const failing: CommandRunner = async () => ({ exitCode: 5, output: "Input/output error" });
    const agent = new LaunchAgent("x.y", join(scratchDirectory(), "x.y.plist"), 501, failing);
    await expect(agent.bootstrap()).rejects.toThrow("Could not load x.y: Input/output error");
  });
});

describe("background host agent", () => {
  function setup() {
    const launchd = new FakeLaunchctl();
    const directory = scratchDirectory();
    const logPath = join(directory, "data", "logs", "host.log");
    const agent = new LaunchAgent("x.host.4600", join(directory, "x.host.4600.plist"), 501, launchd.run);
    return { launchd, agent, background: new BackgroundHostAgent(agent, { shell: "/bin/zsh", overrides: {}, logPath }) };
  }

  test("writes the plist and bootstraps it the first time", async () => {
    const { launchd, agent, background } = setup();
    await background.ensureLoaded(settings);
    expect(launchd.verbs()).toEqual(["bootstrap"]);
    expect(readFileSync(agent.plistPath, "utf8")).toContain("<string>/bun/bin/bun</string>");
  });

  test("leaves an already loaded, unchanged agent alone", async () => {
    const { launchd, background } = setup();
    await background.ensureLoaded(settings);
    await background.ensureLoaded(settings);
    expect(launchd.verbs()).toEqual(["bootstrap"]);
  });

  test("reloads the agent when the settings changed the command", async () => {
    const { launchd, agent, background } = setup();
    await background.ensureLoaded(settings);
    await background.ensureLoaded({ ...settings, bun: "/other/bun" });
    expect(launchd.verbs()).toEqual(["bootstrap", "bootout", "bootstrap"]);
    expect(readFileSync(agent.plistPath, "utf8")).toContain("<string>/other/bun</string>");
  });

  test("restarts through kickstart and removal unloads and deletes", async () => {
    const { launchd, agent, background } = setup();
    await background.ensureLoaded(settings);
    await background.restart();
    await background.remove();
    expect(launchd.verbs()).toEqual(["bootstrap", "kickstart", "bootout"]);
    expect(existsSync(agent.plistPath)).toBe(false);
  });
});

describe("open at login", () => {
  function setup(appPath: string | null) {
    const launchd = new FakeLaunchctl();
    const agent = new LaunchAgent("x.login.4600", join(scratchDirectory(), "x.login.4600.plist"), 501, launchd.run);
    return { launchd, agent, login: new OpenAtLogin(agent, appPath, {}) };
  }

  test("writes the plist without loading it, since launchd reads it at the next login", () => {
    const { launchd, agent, login } = setup("/A.app");
    login.enable();
    expect(login.isEnabled()).toBe(true);
    expect(readFileSync(agent.plistPath, "utf8")).toContain("<string>/A.app</string>");
    expect(launchd.calls).toEqual([]);
  });

  test("disabling removes the plist", async () => {
    const { agent, login } = setup("/A.app");
    login.enable();
    await login.disable();
    expect(login.isEnabled()).toBe(false);
    expect(existsSync(agent.plistPath)).toBe(false);
  });

  test("cannot be enabled outside an app bundle", () => {
    const { login } = setup(null);
    expect(login.available).toBe(false);
    expect(() => login.enable()).toThrow("not running from an app bundle");
  });
});
