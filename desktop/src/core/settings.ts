import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isLanguage, type Language } from "../../../shared/i18n/languages.ts";

export interface DesktopSettings {
  hostDirectory: string;
  bun: string;
  hostRunsInBackground: boolean;
  openAtLogin: boolean;
  /** Mirador's language, as its page last told the app, so the tray and the app's dialogs speak it before any page loads. */
  language: Language;
}

/** Where a build finds the host. */
export type HostLocation = Pick<DesktopSettings, "hostDirectory" | "bun">;

/**
 * What desktop.json holds. A null folder or bun is the copy of Mirador a release build carries, run on the app's own
 * Bun, wherever the app is: a path written at the first launch would break once the app moved to Applications.
 */
export type StoredSettings = Omit<DesktopSettings, keyof HostLocation> & { [Key in keyof HostLocation]: string | null };

export type BuildDefaults = Pick<StoredSettings, keyof HostLocation>;

export const defaultSettings = <Build extends BuildDefaults>(build: Build) => ({
  ...build,
  hostRunsInBackground: false,
  openAtLogin: true,
  language: "en" as Language,
});

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

const storedPath = (value: unknown, fallback: string | null) => (isNonEmptyString(value) ? value : value === null ? null : fallback);

export const withHostLocation = (stored: StoredSettings, insideApp: HostLocation): DesktopSettings => ({
  ...stored,
  hostDirectory: stored.hostDirectory ?? insideApp.hostDirectory,
  bun: stored.bun ?? insideApp.bun,
});

export function parseSettings(text: string, defaults: StoredSettings): StoredSettings {
  const stored = (() => {
    try {
      const parsed = JSON.parse(text);
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  })();
  return {
    hostDirectory: storedPath(stored.hostDirectory, defaults.hostDirectory),
    bun: storedPath(stored.bun, defaults.bun),
    hostRunsInBackground: typeof stored.hostRunsInBackground === "boolean" ? stored.hostRunsInBackground : defaults.hostRunsInBackground,
    openAtLogin: typeof stored.openAtLogin === "boolean" ? stored.openAtLogin : defaults.openAtLogin,
    language: isLanguage(stored.language) ? stored.language : defaults.language,
  };
}

export function saveSettings(file: string, settings: StoredSettings) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

function readIfPresent(file: string) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** The first launch writes the defaults out so the file is there to edit. */
export function loadSettings(file: string, build: BuildDefaults): StoredSettings {
  const defaults = defaultSettings(build);
  const text = readIfPresent(file);
  if (text === null) {
    saveSettings(file, defaults);
    return defaults;
  }
  return parseSettings(text, defaults);
}

export class SettingsStore {
  private stored: StoredSettings;

  constructor(
    private readonly file: string,
    build: BuildDefaults,
    private readonly insideApp: HostLocation,
  ) {
    this.stored = loadSettings(file, build);
  }

  current() {
    return withHostLocation(this.stored, this.insideApp);
  }

  /** Whether the host runs the copy of Mirador the app carries, rather than one the user pointed it at. */
  runsTheMiradorItCarries() {
    return this.stored.hostDirectory === null;
  }

  update(patch: Partial<Omit<DesktopSettings, keyof HostLocation>>) {
    this.stored = { ...this.stored, ...patch };
    saveSettings(this.file, this.stored);
    return this.current();
  }
}
