import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { DeviceService, deviceName } from "../host/devices.ts";
import { Store } from "../host/store.ts";

function devicesAt(clock: { now: number }) {
  return new DeviceService(new Store(":memory:"), () => clock.now);
}

test("an invite lets one device join, however its code is typed, and its token then signs it in", () => {
  const devices = devicesAt({ now: 1_000 });
  const { code } = devices.invite();
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const joined = devices.join(` ${code.toLowerCase().replaceAll("-", " ")} `, "Phone")!;
  expect(joined.device).toMatchObject({ name: "Phone", joinedAt: 1_000, lastSeenAt: 1_000 });
  expect(devices.deviceWithToken(joined.token)?.id).toBe(joined.device.id);
  expect(devices.join(code, "Another")).toBeNull();
  expect(devices.deviceWithToken("not-a-token")).toBeUndefined();
});

test("an invite stops working after 15 minutes", () => {
  const clock = { now: 0 };
  const devices = devicesAt(clock);
  const { code, expiresAt } = devices.invite();
  expect(expiresAt).toBe(15 * 60_000);
  clock.now = expiresAt;
  expect(devices.join(code, "Late")).toBeNull();
});

test("a revoked device's token no longer signs it in, and the other devices stay", () => {
  const devices = devicesAt({ now: 0 });
  const kept = devices.join(devices.invite().code, "Laptop")!;
  const revoked = devices.join(devices.invite().code, "Phone")!;
  devices.revoke(revoked.device.id);
  expect(devices.deviceWithToken(revoked.token)).toBeUndefined();
  expect(devices.list().map(({ name }) => name)).toEqual(["Laptop"]);
  expect(devices.deviceWithToken(kept.token)?.name).toBe("Laptop");
});

test("a device without a name gets one, and a long name is cut short", () => {
  expect(deviceName("  ")).toBe("Unnamed device");
  expect(deviceName(42)).toBe("Unnamed device");
  expect(deviceName("x".repeat(200))).toHaveLength(80);
});

test("a public address needs both origins, and canvas pages then load their libraries from the public one", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "mirador-config-"));
  try {
    const local = loadConfig({ MIRADOR_DATA_DIR: dataDir, MIRADOR_PORT: "4900" });
    expect(local).toMatchObject({ publicOrigin: null, canvasAssetsOrigin: "http://127.0.0.1:4901" });

    const reached = loadConfig({
      MIRADOR_DATA_DIR: dataDir,
      MIRADOR_PUBLIC_ORIGIN: "https://box.example.ts.net/",
      MIRADOR_PUBLIC_CANVAS_ORIGIN: "https://box.example.ts.net:8443",
    });
    expect(reached).toMatchObject({ publicOrigin: "https://box.example.ts.net", canvasAssetsOrigin: "https://box.example.ts.net:8443" });
    expect(reached.appOrigin).toBe("http://127.0.0.1:4600");

    expect(() => loadConfig({ MIRADOR_DATA_DIR: dataDir, MIRADOR_PUBLIC_ORIGIN: "https://box.example.ts.net" })).toThrow(/both/);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
