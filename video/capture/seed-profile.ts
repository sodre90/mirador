/**
 * Run with bun before the trailer's host first starts: its profiles are "Claude Code", as a person's own would be named,
 * and the local model it delegates to, on opencode, but both talk to the director instead of a model.
 * bun capture/seed-profile.ts <database path> <Claude Code's environment> <opencode's environment>
 */
import { join } from "node:path";
import { LOCAL_PROFILE } from "./scenes.ts";

const [databasePath, claudeEnvironment, opencodeEnvironment] = process.argv.slice(2);
const { Store } = await import(join(import.meta.dirname, "..", "..", "host", "store.ts"));
const store = new Store(databasePath);
const profiles = [
  { name: "Claude Code", harness: "claude", environment: claudeEnvironment },
  { name: LOCAL_PROFILE, harness: "opencode", environment: opencodeEnvironment },
];
for (const { name, harness, environment } of profiles) {
  store.saveProfile({
    id: crypto.randomUUID(),
    name,
    harness,
    environment,
    prelaunch: "",
    mode: null,
    bypassPermissions: false,
    askMode: "wait",
    createdAt: Date.now(),
  });
}
store.close();
