/**
 * Run with bun before the trailer's or GIFs' host first starts: seeds "Claude Code" and the local opencode profile,
 * both talking to the scripted Director instead of a real model.
 * bun capture/seed-profile.ts <database path> <Claude Code's environment> <opencode's environment>
 */
import { join } from "node:path";
import type { HarnessId, Profile } from "../../shared/model.ts";
import { LOCAL_PROFILE } from "./scenes.ts";

const [databasePath, claudeEnvironment, opencodeEnvironment] = process.argv.slice(2);
const { Store } = await import(join(import.meta.dirname, "..", "..", "host", "store.ts"));
const store = new Store(databasePath);
const profiles: { name: string; harness: HarnessId; environment: string }[] = [
  { name: "Claude Code", harness: "claude", environment: claudeEnvironment! },
  { name: LOCAL_PROFILE, harness: "opencode", environment: opencodeEnvironment! },
];
for (const { name, harness, environment } of profiles) {
  const profile: Profile = {
    id: crypto.randomUUID(),
    name,
    harness,
    environment,
    prelaunch: "",
    model: null,
    mode: harness === "claude" ? "default" : null,
    effort: null,
    bypassPermissions: false,
    askMode: "wait",
    idleCompaction: true,
    color: null,
    pluginSettings: {},
    pluginsOff: [],
    createdAt: Date.now(),
  };
  store.saveProfile(profile);
}
store.close();
