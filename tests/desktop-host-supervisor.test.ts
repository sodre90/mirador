import { describe, expect, test } from "bun:test";
import type { BackgroundHost } from "../desktop/src/core/background-host.ts";
import { HostSupervisor } from "../desktop/src/core/host-supervisor.ts";
import type { PidFile, ProcessTable } from "../desktop/src/core/processes.ts";
import { defaultSettings, type DesktopSettings } from "../desktop/src/core/settings.ts";

const HOST_COMMAND = "/bun/bin/bun host/main.ts";

class World {
  answering = false;
  pausesUntilAnswering: number | null = null;
  pidOnDisk: number | null = null;
  processes = new Map<number, string>();
  nextPid = 1000;
  agentLoaded = false;
  settings: DesktopSettings = defaultSettings({ hostDirectory: "/repo", bun: "/bun/bin/bun" });
  events: string[] = [];
  spawnedHostsDieImmediately = false;
  agentFailsToLoad = false;
  restartRequests: (() => void)[] = [];

  addExternalHost() {
    this.answering = true;
    this.processes.set(77, HOST_COMMAND);
  }

  supervisor() {
    const world = this;
    const processes: ProcessTable = {
      commandLine: (pid) => world.processes.get(pid) ?? null,
      terminate(pid) {
        world.events.push(`terminate ${pid}`);
        world.processes.delete(pid);
        world.answering = false;
      },
    };
    const pidFile: PidFile = {
      read: () => world.pidOnDisk,
      write(pid) {
        world.pidOnDisk = pid;
      },
      clear() {
        world.pidOnDisk = null;
      },
    };
    const background: BackgroundHost = {
      isLoaded: async () => world.agentLoaded,
      async ensureLoaded() {
        world.events.push("load agent");
        if (world.agentFailsToLoad) throw new Error("bootstrap failed");
        world.agentLoaded = true;
        world.answering = true;
      },
      async restart() {
        world.events.push("kickstart");
      },
      async remove() {
        world.events.push("remove agent");
        world.agentLoaded = false;
        world.answering = false;
      },
      async stopBeforeUpdate() {
        world.events.push("stop agent for update");
        world.answering = false;
      },
    };
    return new HostSupervisor({
      port: 4600,
      logPath: "/data/logs/host.log",
      settings: {
        current: () => world.settings,
        update(patch) {
          world.settings = { ...world.settings, ...patch };
          return world.settings;
        },
      },
      hostAnswers: async () => world.answering,
      spawnHost(_settings, restartRequested) {
        world.restartRequests.push(restartRequested);
        const pid = world.nextPid++;
        world.events.push(`spawn ${pid}`);
        if (!world.spawnedHostsDieImmediately) world.processes.set(pid, HOST_COMMAND);
        world.pausesUntilAnswering = 1;
        return pid;
      },
      processes,
      pidFile,
      background,
      pause: async () => {
        if (world.pausesUntilAnswering === null) return;
        world.pausesUntilAnswering -= 1;
        if (world.pausesUntilAnswering <= 0) {
          world.pausesUntilAnswering = null;
          world.answering = true;
        }
      },
    });
  }
}

describe("host supervisor", () => {
  test("starts and owns a host when nothing answers", async () => {
    const world = new World();
    const supervisor = world.supervisor();
    expect(await supervisor.start()).toBe("owned");
    expect(world.events).toEqual(["spawn 1000"]);
    expect(world.pidOnDisk).toBe(1000);
  });

  test("uses a host that already answers without owning it", async () => {
    const world = new World();
    world.addExternalHost();
    const supervisor = world.supervisor();
    expect(await supervisor.start()).toBe("external");
    expect(world.events).toEqual([]);
    expect(world.pidOnDisk).toBeNull();
  });

  test("recognises its own host again after a relaunch through the recorded pid", async () => {
    const world = new World();
    world.answering = true;
    world.processes.set(321, HOST_COMMAND);
    world.pidOnDisk = 321;
    expect(await world.supervisor().start()).toBe("owned");
    expect(world.events).toEqual([]);
  });

  test("forgets a recorded pid whose process is gone and treats the answering host as not its own", async () => {
    const world = new World();
    world.answering = true;
    world.pidOnDisk = 321;
    expect(await world.supervisor().status()).toBe("external");
    expect(world.pidOnDisk).toBeNull();
  });

  test("forgets a recorded pid that now belongs to an unrelated process and never signals it", async () => {
    const world = new World();
    world.addExternalHost();
    world.processes.set(321, "/usr/bin/vim notes.txt");
    world.pidOnDisk = 321;
    const supervisor = world.supervisor();
    expect(await supervisor.status()).toBe("external");
    expect(supervisor.terminateOwned()).toBe(false);
    expect(world.events).toEqual([]);
    expect(world.processes.has(321)).toBe(true);
  });

  test("does not spawn a second host while the first is still starting", async () => {
    const world = new World();
    world.processes.set(321, '/bin/zsh -ilc exec "$0" "$@" /bun/bin/bun host/main.ts');
    world.pidOnDisk = 321;
    world.pausesUntilAnswering = 1;
    expect(await world.supervisor().start()).toBe("owned");
    expect(world.events).toEqual([]);
  });

  test("quitting terminates only the recorded host and forgets it", async () => {
    const world = new World();
    world.addExternalHost();
    const supervisor = world.supervisor();
    expect(supervisor.terminateOwned()).toBe(false);
    expect(world.events).toEqual([]);

    world.answering = false;
    world.processes.clear();
    await supervisor.start();
    expect(supervisor.terminateOwned()).toBe(true);
    expect(world.events).toEqual(["spawn 1000", "terminate 1000"]);
    expect(world.pidOnDisk).toBeNull();
  });

  test("refuses to restart a host it does not own", async () => {
    const world = new World();
    world.addExternalHost();
    await expect(world.supervisor().restart()).rejects.toThrow("did not start the host");
    expect(world.events).toEqual([]);
  });

  test("restarts an owned host by stopping it and spawning a new one", async () => {
    const world = new World();
    const supervisor = world.supervisor();
    await supervisor.start();
    expect(await supervisor.restart()).toBe("owned");
    expect(world.events).toEqual(["spawn 1000", "terminate 1000", "spawn 1001"]);
    expect(world.pidOnDisk).toBe(1001);
  });

  test("starts an owned host again that exited asking for it, as one on Windows restarts", async () => {
    const world = new World();
    const supervisor = world.supervisor();
    await supervisor.start();
    world.processes.delete(1000);
    world.answering = false;
    world.restartRequests[0]!();
    await Bun.sleep(0);
    expect(world.events).toEqual(["spawn 1000", "spawn 1001"]);
    expect(world.pidOnDisk).toBe(1001);
    expect(await supervisor.status()).toBe("owned");
  });

  test("reports a host that dies right after starting", async () => {
    const world = new World();
    world.spawnedHostsDieImmediately = true;
    await expect(world.supervisor().start()).rejects.toThrow("exited right after starting. Its log is /data/logs/host.log");
    expect(world.pidOnDisk).toBeNull();
  });

  describe("background mode", () => {
    test("turning it on refuses while a host it does not own answers", async () => {
      const world = new World();
      world.addExternalHost();
      await expect(world.supervisor().enableBackground()).rejects.toThrow("did not start already answers on port 4600");
      expect(world.settings.hostRunsInBackground).toBe(false);
      expect(world.events).toEqual([]);
    });

    test("turning it on stops the owned host before the agent takes the port", async () => {
      const world = new World();
      const supervisor = world.supervisor();
      await supervisor.start();
      await supervisor.enableBackground();
      expect(world.events).toEqual(["spawn 1000", "terminate 1000", "load agent"]);
      expect(world.settings.hostRunsInBackground).toBe(true);
      expect(await supervisor.status()).toBe("background");
    });

    test("turning it on with no host running just loads the agent", async () => {
      const world = new World();
      await world.supervisor().enableBackground();
      expect(world.events).toEqual(["load agent"]);
    });

    test("a failed load falls back to an owned host and leaves the setting off", async () => {
      const world = new World();
      world.agentFailsToLoad = true;
      await expect(world.supervisor().enableBackground()).rejects.toThrow("bootstrap failed");
      expect(world.settings.hostRunsInBackground).toBe(false);
      expect(world.events).toEqual(["load agent", "remove agent", "spawn 1000"]);
    });

    test("turning it off removes the agent and takes the host over itself", async () => {
      const world = new World();
      const supervisor = world.supervisor();
      await supervisor.enableBackground();
      world.events.length = 0;
      await supervisor.disableBackground();
      expect(world.events).toEqual(["remove agent", "spawn 1000"]);
      expect(world.settings.hostRunsInBackground).toBe(false);
      expect(await supervisor.status()).toBe("owned");
    });

    test("restarts through launchd and never signals a pid", async () => {
      const world = new World();
      const supervisor = world.supervisor();
      await supervisor.enableBackground();
      world.events.length = 0;
      expect(await supervisor.restart()).toBe("background");
      expect(world.events).toEqual(["kickstart"]);
    });

    test("stops a background host running the app's own copy before an update, and no other host", async () => {
      const world = new World();
      const supervisor = world.supervisor();
      await supervisor.stopBackgroundBeforeUpdate(true);
      await supervisor.enableBackground();
      world.events.length = 0;
      await supervisor.stopBackgroundBeforeUpdate(false);
      expect(world.events).toEqual([]);
      await supervisor.stopBackgroundBeforeUpdate(true);
      expect(world.events).toEqual(["stop agent for update"]);
    });

    test("quitting leaves a background host running", async () => {
      const world = new World();
      const supervisor = world.supervisor();
      await supervisor.enableBackground();
      expect(supervisor.terminateOwned()).toBe(false);
      expect(world.answering).toBe(true);
    });

    test("starting in background mode loads the agent when nothing answers", async () => {
      const world = new World();
      world.settings = { ...world.settings, hostRunsInBackground: true };
      expect(await world.supervisor().start()).toBe("background");
      expect(world.events).toEqual(["load agent"]);
    });
  });
});
