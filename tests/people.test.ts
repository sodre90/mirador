import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceService } from "../host/devices.ts";
import { signedInWith } from "../host/sign-in.ts";
import { Store } from "../host/store.ts";
import { LONGEST_PERSON_NAME, personName } from "../shared/people.ts";
import { TOKEN_COOKIE } from "../shared/protocol.ts";

const scratch = mkdtempSync(join(tmpdir(), "mirador-people-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const databasePath = () => join(scratch, `state-${crypto.randomUUID()}.sqlite`);

test("a new machine has one person, its owner, with no name or colour yet", () => {
  const store = new Store(":memory:");
  expect(store.listPeople()).toEqual([{ id: store.ownerId(), name: "", color: null }]);
});

test("the owner stays the same person when the machine starts again", () => {
  const path = databasePath();
  const first = new Store(path);
  const ownerId = first.ownerId();
  first.close();
  const again = new Store(path);
  expect(again.ownerId()).toBe(ownerId);
  expect(again.listPeople()).toHaveLength(1);
  again.close();
});

test("a person's name and colour are kept", () => {
  const store = new Store(":memory:");
  store.setPersonProfile(store.ownerId(), { name: "Ada Lovelace", color: "teal" });
  expect(store.listPeople()).toEqual([{ id: store.ownerId(), name: "Ada Lovelace", color: "teal" }]);
});

test("the devices that joined before devices belonged to people are the owner's", () => {
  const path = databasePath();
  const before = new Database(path);
  before.run("CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, joined_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)");
  before.run("INSERT INTO devices (id, name, token_hash, joined_at, last_seen_at) VALUES ('phone', 'Phone', 'hash', 1, 2)");
  before.close();

  const store = new Store(path);

  expect(store.listDevices()).toEqual([{ id: "phone", name: "Phone", personId: store.ownerId(), joinedAt: 1, lastSeenAt: 2 }]);
  store.close();
});

test("a device let in with an invite is the owner's, and signs in as the owner, as the host's own link does", () => {
  const store = new Store(":memory:");
  const devices = new DeviceService(store);
  const { device, token } = devices.join(devices.invite().code, "Phone")!;
  const signedIn = signedInWith("browser-token", devices, store.ownerId());
  const withCookie = (value: string) => new Request("http://127.0.0.1/", { headers: { cookie: `${TOKEN_COOKIE}=${value}` } });

  expect(device.personId).toBe(store.ownerId());
  expect(signedIn(withCookie(token))).toEqual({ deviceId: device.id, personId: store.ownerId() });
  expect(signedIn(withCookie("browser-token"))).toEqual({ deviceId: null, personId: store.ownerId() });
  expect(signedIn(withCookie("not-a-token"))).toBeNull();
});

test("a name loses the spaces around it and is cut to its longest", () => {
  expect(personName("  Ada Lovelace  ")).toBe("Ada Lovelace");
  expect(personName("A".repeat(LONGEST_PERSON_NAME + 10))).toBe("A".repeat(LONGEST_PERSON_NAME));
  expect(personName("   ")).toBe("");
});
