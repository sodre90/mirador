import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceService } from "../host/devices.ts";
import { JoinRequestService, SenderAndOverallLimit, SenderLimit, senderForLimits } from "../host/join-requests.ts";
import { Store } from "../host/store.ts";
import { commitmentTo, matchingNumber, newNonce, spacedNumber } from "../shared/join-requests.ts";

const machineAuthority = "m".repeat(43);
const authorityInBetween = "x".repeat(43);

function machine() {
  const clock = { now: 1_000_000 };
  const store = new Store(":memory:");
  const devices = new DeviceService(store, () => clock.now);
  const requests = new JoinRequestService(store, devices, machineAuthority, () => clock.now);
  return { clock, devices, requests };
}

/** A device asking to join as the protocol has it: it commits to its nonce, reveals it, and works out the number it shows. */
async function askToJoin(requests: JoinRequestService, checkedAgainst: string | null = machineAuthority, sentFingerprint = checkedAgainst, fromAddress = "192.168.1.23") {
  const nonce = newNonce();
  const opened = requests.open({ name: "Laptop", commitment: await commitmentTo(nonce), authorityFingerprint: sentFingerprint, fromAddress, tailscaleUser: null });
  await requests.reveal(opened.id, opened.secret, nonce);
  return { ...opened, number: await matchingNumber(checkedAgainst, nonce, opened.machineNonce) };
}

test("the approver types the number the device shows, and the device gets its key", async () => {
  const { devices, requests } = machine();
  const asked = await askToJoin(requests);
  expect(asked.expiresIn).toBe(5 * 60_000);
  expect(requests.waiting()).toEqual([{ id: asked.id, name: "Laptop", fromAddress: "192.168.1.23", tailscaleUser: null, expiresAt: 1_000_000 + 5 * 60_000 }]);
  expect(requests.poll(asked.id, asked.secret)).toEqual({ answer: "waiting" });

  expect(await requests.approve(asked.id, spacedNumber(asked.number))).toBe(true);
  const answer = requests.poll(asked.id, asked.secret);
  expect(answer).toMatchObject({ answer: "approved" });
  if (answer.answer !== "approved") return;
  expect(devices.deviceWithToken(answer.token)).toMatchObject({ id: answer.deviceId, name: "Laptop" });
  expect(requests.waiting()).toEqual([]);
});

test("a device whose answer was lost polls again for a new key of the same device, which replaces the first, until the request expires", async () => {
  const { clock, devices, requests } = machine();
  const asked = await askToJoin(requests);
  await requests.approve(asked.id, asked.number);
  const lost = requests.poll(asked.id, asked.secret);
  const again = requests.poll(asked.id, asked.secret);
  if (lost.answer !== "approved" || again.answer !== "approved") throw new Error("Both polls should have been approved.");

  expect(again.deviceId).toBe(lost.deviceId);
  expect(again.token).not.toBe(lost.token);
  expect(devices.deviceWithToken(lost.token)).toBeUndefined();
  expect(devices.deviceWithToken(again.token)).toMatchObject({ id: lost.deviceId, name: "Laptop" });
  expect(devices.list()).toHaveLength(1);
  expect(requests.waiting()).toEqual([]);
  expect(() => requests.poll(asked.id, "not-the-secret")).toThrow("This request to join expired, or was never made.");

  clock.now += 5 * 60_000;
  expect(() => requests.poll(asked.id, asked.secret)).toThrow("This request to join expired, or was never made.");
  expect(devices.deviceWithToken(again.token)).toMatchObject({ id: lost.deviceId });
});

test("a device revoked after it was admitted gets no new key by polling again", async () => {
  const { devices, requests } = machine();
  const asked = await askToJoin(requests);
  await requests.approve(asked.id, asked.number);
  const admitted = requests.poll(asked.id, asked.secret);
  if (admitted.answer !== "approved") throw new Error("The poll should have been approved.");
  devices.revoke(admitted.deviceId);
  expect(() => requests.poll(asked.id, asked.secret)).toThrow("This request to join expired, or was never made.");
});

test("a delivered request no longer counts among those waiting, and its sender may ask again", async () => {
  const { requests } = machine();
  const asked = await askToJoin(requests);
  await requests.approve(asked.id, asked.number);
  requests.poll(asked.id, asked.secret);
  expect(requests.waiting()).toEqual([]);
  await askToJoin(requests);
});

const anotherNumber = (number: string) => String((Number(number) + 1) % 1_000_000).padStart(6, "0");

test("a wrong number denies the request", async () => {
  const { requests } = machine();
  const asked = await askToJoin(requests);
  expect(await requests.approve(asked.id, anotherNumber(asked.number))).toBe(false);
  expect(requests.poll(asked.id, asked.secret)).toEqual({ answer: "denied" });
  await expect(requests.approve(asked.id, asked.number)).rejects.toThrow("That request to join is no longer waiting.");
});

test("a request denied while its approval is being checked stays denied, and the approval fails", async () => {
  const { requests } = machine();
  const asked = await askToJoin(requests);
  const approving = requests.approve(asked.id, spacedNumber(asked.number));
  requests.deny(asked.id);
  await expect(approving).rejects.toThrow("That request to join is no longer waiting.");
  expect(requests.poll(asked.id, asked.secret)).toEqual({ answer: "denied" });
});

test("an approval whose request was answered and collected meanwhile fails instead of reporting success", async () => {
  const { requests } = machine();
  const asked = await askToJoin(requests);
  const approving = requests.approve(asked.id, spacedNumber(asked.number));
  requests.deny(asked.id);
  expect(requests.poll(asked.id, asked.secret)).toEqual({ answer: "denied" });
  await expect(approving).rejects.toThrow("That request to join is no longer waiting.");
});

test("a machine in between, which says the device checked this machine's own authority, gets a number this machine does not", async () => {
  const { requests } = machine();
  const asked = await askToJoin(requests, authorityInBetween, machineAuthority);
  expect(await requests.approve(asked.id, asked.number)).toBe(false);
});

test("a device that checked another certificate authority is refused, and one that trusted the certificate otherwise is not", async () => {
  const { requests } = machine();
  expect(() => requests.open({ name: "x", commitment: "c".repeat(43), authorityFingerprint: authorityInBetween, fromAddress: "a", tailscaleUser: null })).toThrow(
    "This machine's certificate authority is not the one you checked its certificate against.",
  );
  const asked = await askToJoin(requests, null);
  expect(await requests.approve(asked.id, asked.number)).toBe(true);
});

test("a request waits for approval only once its device revealed the nonce it committed to", async () => {
  const { requests } = machine();
  const opened = requests.open({ name: "Laptop", commitment: await commitmentTo(newNonce()), authorityFingerprint: null, fromAddress: "a", tailscaleUser: null });
  expect(requests.waiting()).toEqual([]);
  await expect(requests.reveal(opened.id, opened.secret, newNonce())).rejects.toThrow("That is not the nonce the request committed to.");
  await expect(requests.reveal(opened.id, "not-the-secret", newNonce())).rejects.toThrow("This request to join expired, or was never made.");
  expect(requests.waiting()).toEqual([]);
});

test("at most three requests wait at once, each for five minutes", async () => {
  const { clock, requests } = machine();
  const askingFrom = (lastNumber: number) => askToJoin(requests, machineAuthority, machineAuthority, `192.168.1.${lastNumber}`);
  const first = await askingFrom(1);
  await askingFrom(2);
  await askingFrom(3);
  await expect(askingFrom(4)).rejects.toThrow("Too many devices are waiting to join this machine.");

  clock.now += 5 * 60_000;
  expect(requests.waiting()).toEqual([]);
  expect(() => requests.poll(first.id, first.secret)).toThrow("This request to join expired, or was never made.");
  await askingFrom(4);
});

test("one sender, an IPv4 address or an IPv6 /64 network, holds one place: its new request takes the place of the one it waits on", async () => {
  const { requests } = machine();
  const askingFrom = (address: string) => askToJoin(requests, machineAuthority, machineAuthority, address);
  const waitingFrom = () => requests.waiting().map(({ fromAddress }) => fromAddress);

  const abandoned = await askingFrom("192.168.1.23");
  await askingFrom("::ffff:192.168.1.23");
  await askingFrom("::ffff:c0a8:117");
  expect(waitingFrom()).toEqual(["::ffff:c0a8:117"]);
  expect(() => requests.poll(abandoned.id, abandoned.secret)).toThrow("This request to join expired, or was never made.");
  await askingFrom("192.168.1.24");

  await askingFrom("2001:db8:1:2:aaaa::1");
  await askingFrom("2001:db8:1:2:bbbb::2");
  await askingFrom("2001:0db8:0001:0002::3%en0");
  expect(new Set(waitingFrom())).toEqual(new Set(["::ffff:c0a8:117", "192.168.1.24", "2001:0db8:0001:0002::3%en0"]));
  await expect(askingFrom("2001:db8:1:3::1")).rejects.toThrow("Too many devices are waiting to join this machine.");
});

test("a sender whose request was answered, or whose request expired, may ask again", async () => {
  const { clock, requests } = machine();
  const first = await askToJoin(requests);
  expect(await requests.approve(first.id, first.number)).toBe(true);
  await askToJoin(requests);
  clock.now += 5 * 60_000;
  await askToJoin(requests);
});

test("requests from an address that is no network address, such as the peer-to-peer tunnel, are not limited per sender", async () => {
  const { requests } = machine();
  await askToJoin(requests, machineAuthority, machineAuthority, "the peer-to-peer tunnel");
  await askToJoin(requests, machineAuthority, machineAuthority, "the peer-to-peer tunnel");
});

test("one sender asks at most five times a minute", () => {
  const clock = { now: 0 };
  const limit = new SenderLimit(() => clock.now);
  expect(Array.from({ length: 6 }, () => limit.allows("192.168.1.23"))).toEqual([true, true, true, true, true, false]);
  expect(limit.allows("192.168.1.24")).toBe(true);
  clock.now += 60_001;
  expect(limit.allows("192.168.1.23")).toBe(true);
});

test("joins are limited for each sender and for all senders together, and one sender over its own limit uses none of the others'", () => {
  const clock = { now: 0 };
  const limit = new SenderAndOverallLimit(() => clock.now, 2, 3);
  expect(["a", "a", "a", "a"].map((sender) => limit.allows(sender))).toEqual([true, true, false, false]);
  expect(["b", "c", "d"].map((sender) => limit.allows(sender))).toEqual([true, false, false]);
  clock.now += 60_001;
  expect(["d", "e", "f", "g"].map((sender) => limit.allows(sender))).toEqual([true, true, true, false]);
});

test("each end of the tunnel asks to join as a sender of its own, though every request through the tunnel comes from the same place", () => {
  const throughTunnel = { fromAddress: "the peer-to-peer tunnel", tailscaleUser: null };
  const limit = new SenderLimit(() => 0, 1);
  const ends = [{ deviceId: "laptop" }, { deviceId: "phone" }, { inviteKey: "invite-1" }, { inviteKey: "invite-2" }];
  expect(ends.map((end) => limit.allows(senderForLimits(end, throughTunnel)))).toEqual([true, true, true, true]);
  expect(limit.allows(senderForLimits({ deviceId: "laptop" }, throughTunnel))).toBe(false);
  expect(senderForLimits(undefined, { fromAddress: "192.168.1.23", tailscaleUser: null })).toBe("192.168.1.23");
  expect(senderForLimits(undefined, { fromAddress: "127.0.0.1", tailscaleUser: "ann@example.com" })).toBe("ann@example.com");
});

test("the number has six digits, and is shown in two groups of three", async () => {
  expect(await matchingNumber(null, "a", "b")).toMatch(/^\d{6}$/);
  expect(spacedNumber("012345")).toBe("012 345");
});

const launcher = join(import.meta.dir, "..", "bin", "mirador");
let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "mirador-approve-"));
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

function approveTyping(...lines: string[]) {
  const result = Bun.spawnSync([launcher, "approve"], { env: { ...process.env, MIRADOR_DATA_DIR: dataDir }, stdin: Buffer.from(lines.map((line) => `${line}\n`).join("")) });
  return `${result.stdout}${result.stderr}`;
}

test("mirador approve asks for the number each waiting device shows, and approves, denies or leaves each as typed", async () => {
  expect(approveTyping()).toContain("No device is asking to join this Mirador.");
  const store = new Store(join(dataDir, "state.sqlite"));
  const requests = new JoinRequestService(store, new DeviceService(store), null);
  const approved = await askToJoin(requests, null, null, "192.168.1.1");
  const mistyped = await askToJoin(requests, null, null, "192.168.1.2");
  const answeredLater = await askToJoin(requests, null, null, "192.168.1.3");

  const output = approveTyping(spacedNumber(approved.number), anotherNumber(mistyped.number), "");
  expect(output).toContain("Laptop asks to join, from 192.168.1.1 (5 minutes left).");
  expect(output).toContain("Approved. Laptop gets in when it next checks, within seconds.");
  expect(output).toContain("That is not the number it shows, so its request was denied.");
  expect(output).toContain("Left waiting.");
  expect(requests.poll(approved.id, approved.secret)).toMatchObject({ answer: "approved" });
  expect(requests.poll(mistyped.id, mistyped.secret)).toEqual({ answer: "denied" });
  expect(requests.poll(answeredLater.id, answeredLater.secret)).toEqual({ answer: "waiting" });

  expect(approveTyping("d")).toContain("Denied.");
  expect(requests.poll(answeredLater.id, answeredLater.secret)).toEqual({ answer: "denied" });
  store.close();
});
