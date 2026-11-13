import { describe, expect, test } from "bun:test";
import type { Conversation } from "../shared/model.ts";
import { giveEveryWorkspaceAProfile, launchForNewWorkspace, moveProfilelessOntoProfiles, profileToLaunch } from "../host/profiles.ts";
import { Store } from "../host/store.ts";

describe("moveProfilelessOntoProfiles", () => {
  function storeFromBeforeProfilesWereRequired() {
    const store = new Store(":memory:");
    store.saveProfile({ id: "p1", name: "work", harness: "claude", environment: "ANTHROPIC_MODEL=opus", prelaunch: "", model: null, mode: "plan", effort: "high", bypassPermissions: true, askMode: "next-message", color: null, pluginsOff: [], createdAt: 1 });
    store.insertWorkspace({ id: "w1", name: "project", path: "/tmp/project", defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
    store.insertWorkspace({ id: "w2", name: "other", path: "/tmp/other", defaultLaunch: { harness: "claude", profileId: "p1" }, createdAt: 2 });
    const conversation = (id: string, change: Partial<Conversation>): Conversation => ({
      id,
      workspaceId: "w1",
      harness: "claude",
      profileId: null,
      title: id,
      titleSetByUser: false,
      acpSessionId: null,
      askMode: "wait",
      bypassPermissions: false,
      status: "idle",
      statusDetail: null,
      openInTerminal: null,
      contextUsage: null,
      queuedMessages: [],
      usageLimit: null,
      jobWaits: [],
      asyncTasks: [],
      waitingFor: null,
      pendingRequest: null,
      lastWords: null,
      activity: null,
      configOptions: [],
      position: 0,
      createdAt: 1,
      updatedAt: 1,
      ...change,
    });
    store.insertConversation(conversation("bare-claude", {}));
    store.insertConversation(conversation("bare-opencode", { harness: "opencode" }));
    store.insertConversation(conversation("on-work", { profileId: "p1" }));
    return store;
  }

  test("moves each installed agent's profile-less workspaces and conversations onto a profile of its own name that adds nothing", () => {
    const store = storeFromBeforeProfilesWereRequired();

    moveProfilelessOntoProfiles(store, ["claude"]);

    const created = store.listProfiles().find(({ name }) => name === "Claude Code")!;
    expect(created).toMatchObject({ harness: "claude", environment: "", prelaunch: "", mode: null, effort: null, bypassPermissions: false, askMode: "wait" });
    expect(store.findWorkspace("w1")!.defaultLaunch).toEqual({ harness: "claude", profileId: created.id });
    expect(store.findWorkspace("w2")!.defaultLaunch.profileId).toBe("p1");
    expect(store.findConversation("bare-claude")!.profileId).toBe(created.id);
    expect(store.findConversation("on-work")!.profileId).toBe("p1");
    expect(store.findConversation("bare-opencode")!.profileId).toBeNull();
    expect(store.listProfiles().map(({ name }) => name)).toEqual(["Claude Code", "work"]);
  });

  test("creates nothing the second time, nor for an agent nothing ran on without a profile", () => {
    const store = storeFromBeforeProfilesWereRequired();
    moveProfilelessOntoProfiles(store, ["claude", "opencode"]);

    moveProfilelessOntoProfiles(store, ["claude", "opencode"]);

    expect(store.listProfiles().map(({ name }) => name)).toEqual(["Claude Code", "opencode", "work"]);
    expect(store.profilelessHarnesses()).toEqual([]);
    const fresh = new Store(":memory:");
    moveProfilelessOntoProfiles(fresh, ["claude", "opencode"]);
    expect(fresh.listProfiles()).toEqual([]);
  });
});

describe("profileToLaunch", () => {
  const store = new Store(":memory:");
  store.saveProfile({ id: "p1", name: "home llama", harness: "opencode", environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [], createdAt: 1 });

  test("gives the profile when it is on its own agent", () => {
    expect(profileToLaunch(store, { harness: "opencode", profileId: "p1" }).name).toBe("home llama");
  });

  test("refuses no profile, a profile on another agent, a deleted profile and an unknown agent", () => {
    expect(() => profileToLaunch(store, { harness: "claude", profileId: null })).toThrow("Every conversation runs on a profile: pick one, or set one up in Profiles.");
    expect(() => profileToLaunch(store, { harness: "claude", profileId: "p1" })).toThrow('Profile "home llama" is for opencode, not Claude Code.');
    expect(() => profileToLaunch(store, { harness: "opencode", profileId: "gone" })).toThrow("That profile no longer exists.");
    expect(() => profileToLaunch(store, { harness: "gemini" as never, profileId: "p1" })).toThrow("Unknown agent gemini.");
  });
});

describe("workspace defaults", () => {
  const profile = (id: string, name: string, harness: "claude" | "opencode", createdAt: number) =>
    ({ id, name, harness, environment: "", prelaunch: "", model: null, mode: null, effort: null, bypassPermissions: false, askMode: "wait", color: null, pluginsOff: [] as string[], createdAt }) as const;
  const workspace = (id: string, profileId: string | null, harness: "claude" | "opencode", createdAt: number) => ({
    id,
    name: id,
    path: `/tmp/${id}`,
    defaultLaunch: { harness, profileId },
    createdAt,
  });

  test("with no profile yet, a workspace starts on none, and the first profile goes to every workspace", () => {
    const store = new Store(":memory:");
    store.insertWorkspace(workspace("w1", null, "claude", 1));
    expect(launchForNewWorkspace(store, null)).toEqual({ harness: "claude", profileId: null });
    expect(giveEveryWorkspaceAProfile(store)).toEqual([]);

    store.saveProfile(profile("p1", "Claude Code", "claude", 1));

    expect(giveEveryWorkspaceAProfile(store).map(({ id, defaultLaunch }) => [id, defaultLaunch])).toEqual([["w1", { harness: "claude", profileId: "p1" }]]);
    expect(giveEveryWorkspaceAProfile(store)).toEqual([]);
  });

  test("a workspace whose profile is gone takes one of the same agent if there is one, else the first", () => {
    const store = new Store(":memory:");
    [profile("a", "alpha", "claude", 1), profile("b", "beta", "opencode", 2)].forEach((each) => store.saveProfile(each));
    store.insertWorkspace(workspace("on-opencode", "deleted", "opencode", 1));
    store.insertWorkspace(workspace("on-claude", "deleted-too", "claude", 2));

    giveEveryWorkspaceAProfile(store);
    expect(store.findWorkspace("on-opencode")!.defaultLaunch).toEqual({ harness: "opencode", profileId: "b" });
    expect(store.findWorkspace("on-claude")!.defaultLaunch).toEqual({ harness: "claude", profileId: "a" });

    store.deleteProfile("b");
    giveEveryWorkspaceAProfile(store);
    expect(store.findWorkspace("on-opencode")!.defaultLaunch).toEqual({ harness: "claude", profileId: "a" });
  });

  test("once there is a profile, a new workspace starts on the one it was added with, and needs one", () => {
    const store = new Store(":memory:");
    [profile("a", "alpha", "claude", 1), profile("o", "omega", "opencode", 2)].forEach((each) => store.saveProfile(each));
    store.insertWorkspace(workspace("latest", "a", "claude", 2));

    expect(launchForNewWorkspace(store, "o")).toEqual({ harness: "opencode", profileId: "o" });
    expect(() => launchForNewWorkspace(store, null)).toThrow("Pick the profile the workspace's conversations start on.");
    expect(() => launchForNewWorkspace(store, undefined as never)).toThrow("Pick the profile the workspace's conversations start on.");
    expect(() => launchForNewWorkspace(store, "deleted")).toThrow("That profile no longer exists.");
  });
});
