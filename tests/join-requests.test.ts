import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceService } from "../host/devices.ts";
import { JoinRequestService, SenderLimit } from "../host/join-requests.ts";
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
async function askToJoin(requests: JoinRequestService, checkedAgainst: string | null = machineAuthority, sentFingerprint = checkedAgainst) {
  const nonce = newNonce();
  const opened = requests.open({ name: "Laptop", commitment: await commitmentTo(nonce), authorityFingerprint: sentFingerprint, fromAddress: "192.168.1.23", tailscaleUser: null });
  await requests.reveal(opened.id, opened.secret, nonce);
  return { ...opened, number: await matchingNumber(checkedAgainst, nonce, opened.machineNonce) };
}

test("the approver types the number the device shows, and the device gets its key once", async () => {
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
  expect(() => requests.poll(asked.id, asked.secret)).toThrow("This request to join expired, or was never made.");
  expect(requests.waiting()).toEqual([]);
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
  const first = await askToJoin(requests);
  await askToJoin(requests);
  await askToJoin(requests);
  await expect(askToJoin(requests)).rejects.toThrow("Too many devices are waiting to join this machine.");

  clock.now += 5 * 60_000;
  expect(requests.waiting()).toEqual([]);
  expect(() => requests.poll(first.id, first.secret)).toThrow("This request to join expired, or was never made.");
  await askToJoin(requests);
});

test("one sender asks at most five times a minute", () => {
  const clock = { now: 0 };
  const limit = new SenderLimit(() => clock.now);
  expect(Array.from({ length: 6 }, () => limit.allows("192.168.1.23"))).toEqual([true, true, true, true, true, false]);
  expect(limit.allows("192.168.1.24")).toBe(true);
  clock.now += 60_001;
  expect(limit.allows("192.168.1.23")).toBe(true);
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
  const approved = await askToJoin(requests, null);
  const mistyped = await askToJoin(requests, null);
  const answeredLater = await askToJoin(requests, null);

  const output = approveTyping(spacedNumber(approved.number), anotherNumber(mistyped.number), "");
  expect(output).toContain("Laptop asks to join, from 192.168.1.23 (5 minutes left).");
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
