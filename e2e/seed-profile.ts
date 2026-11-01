/**
 * Run with Bun before a test host first starts (bun:sqlite is not there in Playwright's Node): gives the host the profile
 * a user sets up first, Claude Code as it is set up on the machine, written with the store of the source the host runs.
 */
import { join } from "node:path";

const [sourceDir, databasePath] = process.argv.slice(2);
const { Store } = await import(join(sourceDir!, "host", "store.ts"));
const store = new Store(databasePath);
if (store.listProfiles().length === 0) {
  store.saveProfile({
    id: crypto.randomUUID(),
    name: "Claude Code",
    harness: "claude",
    environment: "",
    prelaunch: "",
    mode: null,
    effort: null,
    bypassPermissions: false,
    askMode: "wait",
    color: null,
    createdAt: Date.now(),
  });
}
store.close();
