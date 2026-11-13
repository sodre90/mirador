import { isChoiceSetting, type PluginManifest, type PluginSettings, type SecretSettings } from "../shared/apps.ts";
import type { Store } from "./store.ts";
import { HostProblemError } from "../shared/host-problems.ts";

/** The settings the loaded plugins declare, with the values the user chose, which Mirador keeps for every browser. */
export class PluginSettingsStore {
  constructor(
    private readonly store: Store,
    private readonly manifests: PluginManifest[],
    /** The plugins whose host code checks a profile's settings, by name. */
    private readonly checkingProfiles: Set<string>,
  ) {}

  all(): PluginSettings[] {
    const chosen = this.store.listPluginSettings();
    return this.withSettings().map(({ name, settings, profileSettings }) => ({
      plugin: name,
      settings: settings ?? [],
      chosen: chosen[name] ?? {},
      ...(profileSettings && profileSettings.length > 0 && { profileSettings }),
      ...(this.checkingProfiles.has(name) && { checksProfile: true as const }),
    }));
  }

  /** Each plugin's secret profile settings, which only the pages that edit profiles see. */
  secretSettings(): SecretSettings {
    return Object.fromEntries(
      this.withSettings().flatMap(({ name, profileSettings = [] }) => {
        const secrets = profileSettings.filter(({ kind }) => kind === "secret").map(({ id }) => id);
        return secrets.length > 0 ? [[name, secrets]] : [];
      }),
    );
  }

  /** Only a profile setting with choices can be chosen for one conversation; throws for any other. */
  assertChosenPerConversation(plugin: string, settingId: string) {
    const setting = this.withSettings()
      .find(({ name }) => name === plugin)
      ?.profileSettings?.find(({ id }) => id === settingId);
    if (!setting) throw new HostProblemError({ code: "plugin-has-no-setting", plugin, setting: settingId });
    if (!isChoiceSetting(setting)) throw new HostProblemError({ code: "plugin-setting-not-per-conversation", setting: setting.label });
  }

  /** Keeps one of the setting's own choices; throws for anything else. */
  choose(plugin: string, settingId: string, value: string) {
    const setting = this.withSettings()
      .find(({ name }) => name === plugin)
      ?.settings?.find(({ id }) => id === settingId);
    if (!setting) throw new HostProblemError({ code: "plugin-has-no-setting", plugin, setting: settingId });
    if (!setting.choices.some((choice) => choice.value === value)) throw new HostProblemError({ code: "not-a-setting-choice", value, setting: setting.label });
    this.store.savePluginSetting(plugin, settingId, value);
  }

  private withSettings() {
    const seen = new Set<string>();
    const hasAny = ({ settings, profileSettings }: PluginManifest) => (settings?.length ?? 0) + (profileSettings?.length ?? 0) > 0;
    return this.manifests.filter((manifest) => hasAny(manifest) && !seen.has(manifest.name) && seen.add(manifest.name));
  }
}
