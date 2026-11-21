import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceService } from "../host/devices.ts";
import { signedInWith } from "../host/sign-in.ts";
import { Store } from "../host/store.ts";
import { comparableName, LONGEST_PERSON_NAME, NAMES_KEPT_BY_MIRADOR, nameRefused, nameTaken, personName } from "../shared/people.ts";
import { TOKEN_COOKIE } from "../shared/protocol.ts";

const scratch = mkdtempSync(join(tmpdir(), "mirador-people-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const databasePath = () => join(scratch, `state-${crypto.randomUUID()}.sqlite`);

test("names that read the same compare the same, whatever their case, look-alike letters, spaces or invisible characters", () => {
  expect(["Mia", " mia ", "MIA", "\uFF2D\uFF49\uFF41", "Mi\u200Ba", "M\u00ADia", "\u202EMia"].map(comparableName)).toEqual(Array<string>(7).fill("mia"));
  expect(["Mia  Rose", "Mia Rose", "Mia\tRose", "mia\u3000rose", "Mia\u00A0Rose"].map(comparableName)).toEqual(Array<string>(5).fill("mia rose"));
  expect(comparableName("M\u00EDa")).toBe("mia");
});

test("names that only look alike compare the same: Cyrillic and Greek look-alike letters, stray marks, fillers and blanks", () => {
  const lookingLikeAnn = ["\u0410nn", "Ann\u034F", "Ann\uFE0F", "Ann\u3164", "Ann\u2800", "A\u0301nn", "A\u0332nn"];
  expect(lookingLikeAnn.map(comparableName)).toEqual(Array(lookingLikeAnn.length).fill("ann"));
  expect(comparableName("Ann\u2800\u2800Lee")).toBe("ann lee");
  expect(comparableName("\u041C\u0456\u0430")).toBe("mia");
  expect(nameTaken("\u039Fwner", NAMES_KEPT_BY_MIRADOR)).toBe(true);
});

test("a person other than the owner may not take a name that shows its letters in another order, or mixes alphabets in a word", () => {
  expect(["\u202EnnA", "Ann\u2066x\u2069", "A\u200Fnn"].map(nameRefused)).toEqual(Array(3).fill("person-name-reorders"));
  expect(["\u0410nn", "\u039Fwner", "B\u0443ilder", "Ann-\u0405mith"].map(nameRefused)).toEqual(Array(4).fill("person-name-mixes-scripts"));
  expect(["Ann", "\u041C\u0430\u0440\u0438\u044F", "Anna \u041C\u0430\u0440\u0438\u044F", "\u5C71\u7530 \u592A\u90CE", "\u3084\u307E\u7530", "\uAE40\u6C11\u6D19", "Zo\u00EB 2", "Mia R"].map(nameRefused)).toEqual(Array(8).fill(null));
});

test("a name is taken when it reads as one already taken, and a blank one never is", () => {
  expect(nameTaken("\uFF2F\uFF37\uFF2E\uFF25\uFF32", NAMES_KEPT_BY_MIRADOR)).toBe(true);
  expect(nameTaken("someone  without a name", NAMES_KEPT_BY_MIRADOR)).toBe(true);
  expect(nameTaken("you", NAMES_KEPT_BY_MIRADOR)).toBe(true);
  expect(["Tulajdonos", "besitzer", "Alguien sin nombre", "所有者", "Jemand ohne Namen", "Du"].filter((name) => !nameTaken(name, NAMES_KEPT_BY_MIRADOR))).toEqual([]);
  const standIns = ["An agent no longer in the room", "Egy ágens, amely már nincs a szobában", "From Mirador", "Von einem Skript", "member", "Gast", "成员", "Ágens"];
  expect(standIns.filter((name) => !nameTaken(name, NAMES_KEPT_BY_MIRADOR))).toEqual([]);
  expect(nameTaken("Builder\u200D", ["builder"])).toBe(true);
  expect(nameTaken("Builder 2", ["builder"])).toBe(false);
  expect(nameTaken("", ["", "Mia"])).toBe(false);
  expect(nameTaken("\u200B ", [""])).toBe(false);
});

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
  expect(signedIn(withCookie(token))).toEqual({ deviceId: device.id, personId: store.ownerId(), isOwner: true });
  expect(signedIn(withCookie("browser-token"))).toEqual({ deviceId: null, personId: store.ownerId(), isOwner: true });
  expect(signedIn(withCookie("not-a-token"))).toBeNull();
});

test("a device of another person signs in as that person, who is not the owner", () => {
  const store = new Store(":memory:");
  const devices = new DeviceService(store);
  store.insertPerson({ id: "mia", name: "Mia", color: null });
  const { device, token } = devices.admit("Mia's laptop", "mia");
  const signedIn = signedInWith("browser-token", devices, store.ownerId());

  expect(store.listPeople().map(({ id }) => id)).toEqual([store.ownerId(), "mia"]);
  expect(signedIn(new Request("http://127.0.0.1/", { headers: { cookie: `${TOKEN_COOKIE}=${token}` } }))).toEqual({ deviceId: device.id, personId: "mia", isOwner: false });
});

test("a name loses the spaces around it and is cut to its longest", () => {
  expect(personName("  Ada Lovelace  ")).toBe("Ada Lovelace");
  expect(personName("A".repeat(LONGEST_PERSON_NAME + 10))).toBe("A".repeat(LONGEST_PERSON_NAME));
  expect(personName("   ")).toBe("");
});
