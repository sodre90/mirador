import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutostartEntry, autostartEntry, autostartEntryPath, execArgument } from "../desktop/src/core/autostart.ts";
import type { CommandRunner } from "../desktop/src/core/commands.ts";
import { hostArgv } from "../desktop/src/core/host-command.ts";
import { defaultSettings } from "../desktop/src/core/settings.ts";
import { execStartArgument, hostServiceName, hostServiceUnit, HostUserService, userUnitPath } from "../desktop/src/core/systemd.ts";

const settings = defaultSettings({ hostDirectory: "/repo", bun: "/bun/bin/bun" });
const directories: string[] = [];

function scratchDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "mirador-linux-"));
  directories.push(directory);
  return directory;
}

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

class FakeSystemctl {
  calls: string[][] = [];
  enabled = false;

  run: CommandRunner = async (argv) => {
    const verbs = argv.slice(2);
    this.calls.push(verbs);
    if (verbs[0] === "is-enabled") return { exitCode: this.enabled ? 0 : 1, output: "" };
    if (verbs[0] === "enable") this.enabled = true;
    if (verbs[0] === "disable") this.enabled = false;
    return { exitCode: 0, output: "" };
  };

  changes = () => this.calls.filter(([verb]) => verb !== "is-enabled").map((verbs) => verbs.join(" "));
}

describe("host user service unit", () => {
  test.skipIf(process.platform === "win32")("is named and placed per port, under the user's config folder", () => {
    expect(hostServiceName(4600)).toBe("mirador-host-4600.service");
    expect(userUnitPath("/home/me/.config", hostServiceName(4790))).toBe("/home/me/.config/systemd/user/mirador-host-4790.service");
  });

  test("quotes each argument so systemd neither splits it nor expands $ or % in it", () => {
    expect(execStartArgument("/bin/bash")).toBe('"/bin/bash"');
    expect(execStartArgument('exec "$0" "$@"')).toBe('"exec \\"$$0\\" \\"$$@\\""');
    expect(execStartArgument("50%\\done")).toBe('"50%%\\\\done"');
  });

  test("runs the host through the login shell, restarts it, and appends its output to the log", () => {
    const unit = hostServiceUnit({ port: 4600, argv: hostArgv("/bin/bash", "/bun/bin/bun", {}, "/repo"), workingDirectory: "/repo", logPath: "/home/me/.mirador/logs/host.log" });
    expect(unit).toBe(
      [
        "[Unit]",
        "Description=Mirador host on port 4600",
        "",
        "[Service]",
        'ExecStart="/bin/bash" "-ilc" "cd -- \\"$$0\\" && exec \\"$$@\\"" "/repo" "/bun/bin/bun" "host/main.ts"',
        "WorkingDirectory=/repo",
        "Restart=always",
        "StandardOutput=append:/home/me/.mirador/logs/host.log",
        "StandardError=append:/home/me/.mirador/logs/host.log",
        "",
        "[Install]",
        "WantedBy=default.target",
        "",
      ].join("\n"),
    );
  });
});

describe("host service unit under fish", () => {
  test("keeps fish's $argv from systemd's expansion", () => {
    const unit = hostServiceUnit({ port: 4600, argv: hostArgv("/usr/bin/fish", "/bun/bin/bun", {}, "/repo"), workingDirectory: "/repo", logPath: "/home/me/.mirador/logs/host.log" });
    expect(unit).toContain('ExecStart="/usr/bin/fish" "-ilc" "cd -- $$argv[1] && exec $$argv[2..-1]" "/repo" "/bun/bin/bun" "host/main.ts"');
  });
});

describe("host user service", () => {
  const serviceIn = (directory: string, systemctl: FakeSystemctl) =>
    new HostUserService(4600, join(directory, "systemd", "user", "mirador-host-4600.service"), { shell: "/bin/bash", overrides: {}, logPath: join(directory, "logs", "host.log") }, systemctl.run);

  test("writes the unit, then enables and starts it, and leaves a matching enabled unit alone", async () => {
    const directory = scratchDirectory();
    const systemctl = new FakeSystemctl();
    const service = serviceIn(directory, systemctl);

    await service.ensureLoaded(settings);
    expect(systemctl.changes()).toEqual(["daemon-reload", "enable mirador-host-4600.service", "restart mirador-host-4600.service"]);
    expect(readFileSync(join(directory, "systemd", "user", "mirador-host-4600.service"), "utf8")).toContain('"/bun/bin/bun" "host/main.ts"');
    expect(existsSync(join(directory, "logs"))).toBe(true);
    expect(await service.isLoaded()).toBe(true);

    systemctl.calls = [];
    await service.ensureLoaded(settings);
    expect(systemctl.changes()).toEqual([]);

    await service.ensureLoaded({ ...settings, bun: "/other/bun" });
    expect(systemctl.changes()).toEqual(["daemon-reload", "enable mirador-host-4600.service", "restart mirador-host-4600.service"]);
  });

  test("removing it stops and disables it, and deletes the unit", async () => {
    const directory = scratchDirectory();
    const systemctl = new FakeSystemctl();
    const service = serviceIn(directory, systemctl);
    await service.ensureLoaded(settings);
    systemctl.calls = [];

    await service.remove();
    expect(systemctl.changes()).toEqual(["disable --now mirador-host-4600.service", "daemon-reload"]);
    expect(existsSync(join(directory, "systemd", "user", "mirador-host-4600.service"))).toBe(false);
    expect(await service.isLoaded()).toBe(false);
  });

  test("explains a failed systemctl call", async () => {
    const failing: CommandRunner = async () => ({ exitCode: 1, output: "Failed to connect to bus" });
    const service = new HostUserService(4600, join(scratchDirectory(), "unit.service"), { shell: "/bin/bash", overrides: {}, logPath: join(scratchDirectory(), "host.log") }, failing);
    await expect(service.ensureLoaded(settings)).rejects.toThrow("Could not reload the user units: Failed to connect to bus");
  });
});

describe("autostart entry", () => {
  test.skipIf(process.platform === "win32")("is named per port in the user's autostart folder", () => {
    expect(autostartEntryPath("/home/me/.config", 4600)).toBe("/home/me/.config/autostart/mirador-4600.desktop");
  });

  test("quotes Exec arguments as the desktop entry spec asks", () => {
    expect(execArgument("/opt/mirador/app/bin/launcher")).toBe("/opt/mirador/app/bin/launcher");
    expect(execArgument("/home/me/My Apps/launcher")).toBe('"/home/me/My Apps/launcher"');
    expect(execArgument("a$b")).toBe('"a\\\\$b"');
    expect(execArgument("100%")).toBe("100%%");
  });

  test("starts the installed launcher, passing a non-default port or data folder", () => {
    expect(autostartEntry({ appName: "Mirador", launcherPath: "/x/app/bin/launcher", overrides: {} })).toBe(
      ["[Desktop Entry]", "Type=Application", "Name=Mirador", "Exec=/x/app/bin/launcher", "X-GNOME-Autostart-enabled=true", ""].join("\n"),
    );
    expect(autostartEntry({ appName: "Mirador", launcherPath: "/x/app/bin/launcher", overrides: { MIRADOR_PORT: "4790" } })).toContain(
      "Exec=/usr/bin/env MIRADOR_PORT=4790 /x/app/bin/launcher",
    );
  });

  test("is written on enable and deleted on disable, and refused for a copy that is not installed", () => {
    const path = join(scratchDirectory(), "autostart", "mirador-4600.desktop");
    const entry = new AutostartEntry(path, { appName: "Mirador", overrides: {} }, "/x/app/bin/launcher");
    entry.enable();
    expect(readFileSync(path, "utf8")).toContain("Exec=/x/app/bin/launcher");
    entry.disable();
    expect(existsSync(path)).toBe(false);

    const uninstalled = new AutostartEntry(path, { appName: "Mirador", overrides: {} }, null);
    expect(uninstalled.available).toBe(false);
    expect(() => uninstalled.enable()).toThrow("not an installed app");
  });
});
