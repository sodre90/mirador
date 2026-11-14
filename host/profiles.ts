import { askModeLabels, harnessIds, harnessLabels, isPastel, type HarnessId, type Launch, type Profile, type Workspace } from "../shared/model.ts";
import { parseEnvironment } from "../shared/profile-environment.ts";
import type { ProfileDraft } from "../shared/protocol.ts";
import type { ConversationService } from "./conversations.ts";
import type { BrowserSocket, Hub } from "./hub.ts";
import type { Store } from "./store.ts";
import { HostProblemError } from "../shared/host-problems.ts";
import { withoutSecrets, withPluginTurned, type PluginToggleProfileSetting, type SecretSettings } from "../shared/apps.ts";

/** Every conversation runs on a profile, and a profile only on the agent it was made for; the picker sends both, and the host checks they agree. */
export function profileToLaunch(store: Store, launch: Launch): Profile {
  if (!harnessIds.includes(launch.harness)) throw new HostProblemError({ code: "unknown-agent", agent: launch.harness });
  if (launch.profileId === null) throw new HostProblemError({ code: "profile-required" });
  const profile = store.findProfile(launch.profileId);
  if (!profile) throw new HostProblemError({ code: "profile-gone" });
  if (profile.harness !== launch.harness) {
    throw new HostProblemError({ code: "profile-is-for-other-agent", profile: profile.name, profileAgent: harnessLabels[profile.harness], agent: harnessLabels[launch.harness] });
  }
  return profile;
}

const launchOn = ({ harness, id }: Profile): Launch => ({ harness, profileId: id });

/**
 * Once there is a profile, every workspace starts its conversations on one: a workspace without one, or whose profile
 * was deleted, takes one of the same agent if there is one, else the first. Gives the workspaces that changed.
 */
export function giveEveryWorkspaceAProfile(store: Store): Workspace[] {
  const profiles = store.listProfiles();
  if (profiles.length === 0) return [];
  const hasOne = ({ defaultLaunch }: Workspace) => profiles.some(({ id }) => id === defaultLaunch.profileId);
  return store
    .listWorkspaces()
    .filter((workspace) => !hasOne(workspace))
    .map(({ id, defaultLaunch }) => {
      store.setWorkspaceDefaultLaunch(id, launchOn(profiles.find(({ harness }) => harness === defaultLaunch.harness) ?? profiles[0]!));
      return store.findWorkspace(id)!;
    });
}

/** A new workspace starts its conversations on the profile it was added with; with no profile yet, on none. */
export function launchForNewWorkspace(store: Store, profileId: string | null): Launch {
  if (store.listProfiles().length === 0) return { harness: "claude", profileId: null };
  if (!profileId) throw new HostProblemError({ code: "pick-workspace-profile" });
  const profile = store.findProfile(profileId);
  if (!profile) throw new HostProblemError({ code: "profile-gone" });
  return launchOn(profile);
}

/**
 * Workspaces and conversations from before every conversation ran on a profile move onto one per agent, named after it
 * and with nothing of its own, so they run as they did. Only for the agents this machine has a program for.
 */
export function moveProfilelessOntoProfiles(store: Store, installed: HarnessId[]) {
  store
    .profilelessHarnesses()
    .filter((harness) => installed.includes(harness))
    .forEach((harness) =>
      store.putProfilelessOn({
        id: crypto.randomUUID(),
        name: harnessLabels[harness],
        harness,
        environment: "",
        prelaunch: "",
        model: null,
        mode: null,
        effort: null,
        bypassPermissions: false,
        askMode: "wait",
        color: null,
        pluginsOff: [],
        createdAt: Date.now(),
      }),
    );
}

/** A profile as a socket gets it: without what it launches its agent with, nor its plugins' secrets, unless the socket's page edits profiles. */
export const profileFor = (socket: BrowserSocket, profile: Profile, secrets: SecretSettings): Profile => {
  if (socket.data.readsProfileLaunch) return profile;
  const { pluginSettings, ...withoutLaunch } = { ...profile, environment: "", prelaunch: "" };
  const shownSettings = withoutSecrets(pluginSettings, secrets);
  return shownSettings ? { ...withoutLaunch, pluginSettings: shownSettings } : withoutLaunch;
};

/**
 * How a profile turns a plugin: by the toggle its plugin.json makes its switch, or else by naming it among the plugins
 * off. Undefined for a plugin a profile can't turn, one that neither gives conversations anything nor has a switch.
 */
export type PluginTurning = (plugin: string) => { pluginSwitch: PluginToggleProfileSetting | undefined } | undefined;

/** The plugins a draft turns off, each once and sorted, so an unchanged choice compares equal. */
function pluginNames(pluginsOff: unknown): string[] {
  if (!Array.isArray(pluginsOff) || !pluginsOff.every((name) => typeof name === "string")) throw new HostProblemError({ code: "profile-plugins-off-invalid" });
  return [...new Set(pluginsOff)].sort();
}

export class ProfileService {
  private profilesChanged = () => {};
  private savedOver = (_previous: Profile, _saved: Profile) => {};

  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly conversations: ConversationService,
    private readonly secrets: SecretSettings,
    private readonly turningOf: PluginTurning,
  ) {}

  /** What else follows the profiles, such as plugin tabs that list them, hears each save and delete. */
  whenProfilesChange(listener: () => void) {
    this.profilesChanged = listener;
  }

  /** Hears each save over a profile that was there, with the profile as it was and as saved. */
  whenSavedOver(listener: (previous: Profile, saved: Profile) => void) {
    this.savedOver = listener;
  }

  save(draft: ProfileDraft): Profile {
    const name = draft.name.trim();
    if (!name) throw new HostProblemError({ code: "profile-needs-name" });
    const { errors } = parseEnvironment(draft.environment);
    if (errors.length > 0) throw new Error(errors.join("\n"));
    const existing = draft.id ? this.store.findProfile(draft.id) : undefined;
    if (draft.id && !existing) throw new HostProblemError({ code: "profile-gone" });
    if (!harnessIds.includes(draft.harness)) throw new HostProblemError({ code: "unknown-agent", agent: draft.harness });
    if (!(draft.askMode in askModeLabels)) throw new HostProblemError({ code: "unknown-questions-setting", value: draft.askMode });
    if (draft.color !== null && !isPastel(draft.color)) throw new HostProblemError({ code: "unknown-colour", value: draft.color });
    const profile: Profile = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      harness: existing?.harness ?? draft.harness,
      environment: draft.environment,
      prelaunch: draft.prelaunch,
      model: draft.model || null,
      mode: draft.mode || null,
      effort: draft.effort || null,
      bypassPermissions: draft.bypassPermissions,
      askMode: draft.askMode,
      ...(draft.idleCompaction === false && { idleCompaction: false }),
      color: draft.color,
      ...(draft.pluginSettings && { pluginSettings: draft.pluginSettings }),
      pluginsOff: pluginNames(draft.pluginsOff),
      createdAt: existing?.createdAt ?? Date.now(),
    };
    this.store.saveProfile(profile);
    const launchChanged = existing && (existing.environment !== profile.environment || existing.prelaunch !== profile.prelaunch);
    if (launchChanged) this.conversations.restartProfile(profile.id);
    if (existing) this.savedOver(existing, profile);
    this.hub.sendEach((socket) => ({ type: "profile.upserted", profile: profileFor(socket, profile, this.secrets) }));
    if (!existing) this.broadcastWorkspaces(giveEveryWorkspaceAProfile(this.store));
    this.profilesChanged();
    return profile;
  }

  /** Turns one plugin on or off for the profile as stored, saved as any edit is, so running conversations gain or lose it. */
  turnPlugin(profileId: string, plugin: string, on: boolean): Profile {
    const profile = this.store.findProfile(profileId);
    if (!profile) throw new HostProblemError({ code: "profile-gone" });
    const turning = this.turningOf(plugin);
    if (!turning) throw new HostProblemError({ code: "plugin-not-turnable", plugin });
    return this.save(withPluginTurned(profile, plugin, turning.pluginSwitch, on));
  }

  /** The last profile stays: without one, no conversation could start. Workspaces that used a deleted one move to another. */
  delete(profileId: string) {
    if (this.store.listProfiles().every(({ id }) => id === profileId)) {
      throw new HostProblemError({ code: "last-profile" });
    }
    this.store.deleteProfile(profileId);
    this.conversations.restartProfile(profileId);
    this.hub.broadcast({ type: "profile.deleted", profileId });
    this.broadcastWorkspaces(giveEveryWorkspaceAProfile(this.store));
    this.profilesChanged();
  }

  private broadcastWorkspaces(workspaces: Workspace[]) {
    workspaces.forEach((workspace) => this.hub.broadcast({ type: "workspace.upserted", workspace }));
  }

  setWorkspaceDefault(workspaceId: string, launch: Launch) {
    profileToLaunch(this.store, launch);
    this.store.setWorkspaceDefaultLaunch(workspaceId, launch);
    const workspace = this.store.findWorkspace(workspaceId);
    if (workspace) this.hub.broadcast({ type: "workspace.upserted", workspace });
  }
}
