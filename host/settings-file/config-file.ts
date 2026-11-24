import { existsSync, readFileSync } from "node:fs";
import { HostProblemError, causeOf, type HostProblem } from "../../shared/host-problems.ts";
import type { ConfigFileStatus, SettingsFile, SettingsImportReport } from "../../shared/settings-file.ts";
import { errorMessage } from "../conversations.ts";
import type { Store } from "../store.ts";
import type { SettingsImport } from "./import-settings.ts";
import { readSettingsFile } from "./read-settings-file.ts";

const NOTHING: SettingsImportReport = { added: [], overwritten: [], same: [], problems: [] };

/** Brings what the config file names into Mirador, over what it has; what the file doesn't name stays, and so does the sidebar's order. */
export async function applyConfigFile(path: string, settingsImport: SettingsImport, store: Store): Promise<ConfigFileStatus> {
  if (!existsSync(path)) return { path, found: false, ...NOTHING, profileIds: [], promptTemplateIds: [] };
  try {
    const { file, problems } = readSettingsFile(readFileSync(path, "utf8"));
    const { profiles, promptTemplates, workspaces } = file;
    const report = await settingsImport.bringIn({ schemaVersion: file.schemaVersion, profiles, promptTemplates, workspaces }, problems, ({ kind }) => kind !== "sidebar-order");
    return { path, found: true, ...report, ...idsOfNamed(file, store) };
  } catch (error) {
    return { path, found: true, ...NOTHING, problems: [problemReading(path, error)], profileIds: [], promptTemplateIds: [] };
  }
}

const problemReading = (path: string, error: unknown): HostProblem =>
  error instanceof HostProblemError ? error.problem : { code: "settings-item-failed", name: path, ...causeOf(error, errorMessage(error)) };

function idsOfNamed({ profiles = [], promptTemplates = [] }: SettingsFile, store: Store) {
  return {
    profileIds: store
      .listProfiles()
      .filter(({ name, harness }) => profiles.some((entry) => entry.name === name && entry.harness === harness))
      .map(({ id }) => id),
    promptTemplateIds: store
      .listPromptTemplates()
      .filter(({ name }) => promptTemplates.some((entry) => entry.name === name))
      .map(({ id }) => id),
  };
}
