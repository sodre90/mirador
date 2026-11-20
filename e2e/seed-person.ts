/**
 * Run with Bun (bun:sqlite is not there in Playwright's Node): adds a person other than the owner to a test host's
 * machine, with a device of theirs, through the store and device service of the source the host runs. Prints the
 * person's id and the device's token as JSON.
 */
import { join } from "node:path";

const [sourceDir, databasePath, name] = process.argv.slice(2);
const { Store } = await import(join(sourceDir!, "host", "store.ts"));
const { DeviceService } = await import(join(sourceDir!, "host", "devices.ts"));
const store = new Store(databasePath);
const personId = crypto.randomUUID();
store.insertPerson({ id: personId, name: name!, color: null });
const { token } = new DeviceService(store).admit(`${name}'s browser`, personId);
store.close();
console.log(JSON.stringify({ personId, token }));
