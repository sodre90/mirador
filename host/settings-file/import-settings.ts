import { causeOf, type HostProblem } from "../../shared/host-problems.ts";
import type { SettingsFile, SettingsImportReport, SettingsItem, SettingsPlan } from "../../shared/settings-file.ts";
import { errorMessage, type ConversationService } from "../conversations.ts";
import type { InstalledPlugins } from "../apps/installed-plugins.ts";
import type { Hub } from "../hub.ts";
import type { PluginSettingsStore } from "../plugin-settings.ts";
import type { ProfileService } from "../profiles.ts";
import { savePromptTemplate } from "../prompt-templates.ts";
import type { Store } from "../store.ts";
import type { WorkspaceSandboxes } from "../workspace-sandbox.ts";
import { pluginSettingsSteps, pluginsToInstall } from "./import-plugins.ts";
import { preferenceSteps, type PreferenceWriters } from "./import-preferences.ts";
import { profileSteps } from "./import-profiles.ts";
import type { ImportContext, ImportStep } from "./import-step.ts";
import { sidebarSteps } from "./import-sidebar.ts";
import { templateSteps } from "./import-templates.ts";
import { readSettingsFile } from "./read-settings-file.ts";

/** Where a workspace's profile was chosen, in the host's log. */
const FROM_A_FILE = "a settings file";

export interface ImportServices {
  dataDir: string;
  store: Store;
  hub: Hub;
  profiles: ProfileService;
  conversations: Pick<ConversationService, "setWorktreeSettings" | "setSideChatAccess">;
  workspaceSandboxes: Pick<WorkspaceSandboxes, "setSandbox">;
  plugins: InstalledPlugins;
  pluginSettings: PluginSettingsStore;
}

/** What the server saves from Settings, with the checks it has there. */
export interface SettingsWriters extends PreferenceWriters {
  updatesByItself(folder: string, updatesByItself: boolean): Promise<void>;
}

/** Brings a settings file into this Mirador: what is new, and what the user chose to overwrite. */
export class SettingsImport {
  private writers: SettingsWriters | null = null;

  constructor(private readonly services: ImportServices) {}

  savesSettingsWith(writers: SettingsWriters) {
    this.writers = writers;
  }

  async plan(text: string): Promise<SettingsPlan> {
    const { file, problems } = readSettingsFile(text);
    const context = this.contextWith(problems);
    const steps = await this.steps(file, context);
    const plugins = pluginsToInstall(file.plugins ?? [], await this.services.plugins.list(), context);
    return { items: steps.map(({ item }) => item), plugins, problems };
  }

  /** Brings in the chosen items, by id, unless they are here as they are in the file. */
  bringInChosen(text: string, chosen: string[]): Promise<SettingsImportReport> {
    const { file, problems } = readSettingsFile(text);
    return this.bringIn(file, problems, ({ id }) => chosen.includes(id));
  }

  async bringIn(file: SettingsFile, problems: HostProblem[], chooses: (item: SettingsItem) => boolean): Promise<SettingsImportReport> {
    const context = this.contextWith(problems);
    const planned = await this.steps(file, context);
    const steps = planned.filter(({ item }) => item.state !== "same" && chooses(item));
    const broughtIn: ImportStep[] = [];
    for (const step of steps) if (await this.succeeds(step.item, () => step.bringIn(), context)) broughtIn.push(step);
    for (const step of broughtIn) if (step.finish) await this.succeeds(step.item, () => step.finish!(), context);
    this.showSidebar(steps);
    const inState = (those: ImportStep[], state: SettingsItem["state"]) => those.map(({ item }) => item).filter((item) => item.state === state);
    return { added: inState(broughtIn, "new"), overwritten: inState(broughtIn, "different"), same: inState(planned, "same"), problems: context.problems };
  }

  private contextWith = (problems: HostProblem[]): ImportContext => ({ store: this.services.store, dataDir: this.services.dataDir, problems });

  private async steps(file: SettingsFile, context: ImportContext): Promise<ImportStep[]> {
    const { store, hub, profiles, conversations, workspaceSandboxes, plugins, pluginSettings } = this.services;
    const writers = this.writers;
    const beforeTheServer = [
      ...profileSteps(file.profiles ?? [], context, (draft) => profiles.save(draft)),
      ...templateSteps(file.promptTemplates ?? [], context, (draft) => savePromptTemplate(store, hub, draft)),
      ...(await sidebarSteps(file.workspaces ?? [], context, {
        setDefaultLaunch: (workspaceId, launch) => profiles.setWorkspaceDefault(workspaceId, launch, FROM_A_FILE),
        setWorktreeSettings: (workspaceId, newConversationsIn, worktreeSetup) => conversations.setWorktreeSettings(workspaceId, newConversationsIn, worktreeSetup),
        setSideChatAccess: (workspaceId, sideChatAccess) => conversations.setSideChatAccess(workspaceId, sideChatAccess),
        setSandbox: (workspaceId, sandbox) => workspaceSandboxes.setSandbox(workspaceId, sandbox),
      })),
    ];
    if (!writers) return beforeTheServer;
    return [
      ...beforeTheServer,
      ...preferenceSteps(file.preferences ?? {}, context, writers),
      ...pluginSettingsSteps(file.plugins ?? [], await plugins.list(), context, {
        settings: pluginSettings,
        settingsChanged: () => hub.broadcast({ type: "plugins.settings", pluginSettings: pluginSettings.all() }),
        updatesByItself: writers.updatesByItself,
      }),
    ];
  }

  /** One that fails leaves the others be. */
  private async succeeds(item: SettingsItem, work: () => void | Promise<void>, { problems }: ImportContext) {
    try {
      await work();
      return true;
    } catch (error) {
      problems.push({ code: "settings-item-failed", name: item.name || item.kind, ...causeOf(error, errorMessage(error)) });
      return false;
    }
  }

  /** One that failed may have come in all but for what it failed at. */
  private showSidebar(tried: ImportStep[]) {
    if (!tried.some(({ item }) => ["group", "workspace", "sidebar-order"].includes(item.kind))) return;
    const { store, hub } = this.services;
    store.listWorkspaceGroups().forEach((group) => hub.broadcast({ type: "workspace-group.upserted", group }));
    store.listWorkspaces().forEach((workspace) => hub.broadcast({ type: "workspace.upserted", workspace }));
  }
}
