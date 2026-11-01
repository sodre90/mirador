import { describe, expect, test } from "bun:test";
import { Hub, socketData, type BrowserSocket, type SocketData } from "../host/hub.ts";
import { connectedFrom, deviceStatus, otherConnectedDevices } from "../shared/devices.ts";
import type { ClientAddress, DeviceConnection, ListedDevice } from "../shared/model.ts";
import { connectedDevicesLabel } from "../web/connected-devices.ts";

const phoneAddress: ClientAddress = { fromAddress: "100.101.5.7", tailscaleUser: "someone@github" };
const laptopAddress: ClientAddress = { fromAddress: "192.168.1.23", tailscaleUser: null };

function connect(hub: Hub, role: SocketData["role"], deviceId: string | null, from: ClientAddress = laptopAddress) {
  const socket = { data: socketData(role, deviceId, "", from), send: () => {} } as unknown as BrowserSocket;
  hub.add(socket);
  return socket;
}

describe("Hub.deviceConnections", () => {
  test("counts each joined device's pages, and a device whose app only listens is connected with none", () => {
    const hub = new Hub();
    connect(hub, "page", null);
    connect(hub, "notifier", null);
    connect(hub, "page", "laptop");
    connect(hub, "page", "laptop");
    connect(hub, "notifier", "phone", phoneAddress);
    expect(Object.fromEntries(hub.deviceConnections())).toEqual({
      laptop: { ...laptopAddress, pages: 2 },
      phone: { ...phoneAddress, pages: 0 },
    });
  });

  test("a device is no longer connected once its last socket closes, and its latest connection says where it is", () => {
    const hub = new Hub();
    const atHome = connect(hub, "page", "laptop");
    const elsewhere = connect(hub, "page", "laptop", phoneAddress);
    expect(hub.deviceConnections().get("laptop")).toEqual({ ...phoneAddress, pages: 2 });
    hub.remove(elsewhere);
    hub.remove(atHome);
    expect(hub.deviceConnections().size).toBe(0);
  });
});

describe("device wording", () => {
  const device = (id: string, connection: DeviceConnection | null): ListedDevice => ({ id, name: id, joinedAt: 0, lastSeenAt: Date.now() - 3 * 3_600_000, connection });

  test("a connected device says how many pages it has open, or that it listens in the background; another when it was last seen", () => {
    expect(deviceStatus(device("a", { ...laptopAddress, pages: 1 }))).toBe("connected now, 1 page open");
    expect(deviceStatus(device("a", { ...laptopAddress, pages: 2 }))).toBe("connected now, 2 pages open");
    expect(deviceStatus(device("a", { ...phoneAddress, pages: 0 }))).toBe("connected now, in the background");
    expect(deviceStatus(device("a", null))).toBe("last seen 3 hours ago");
  });

  test("where it connects from names the Tailscale login when there is one", () => {
    expect(connectedFrom({ ...phoneAddress, pages: 1 })).toBe("from 100.101.5.7 (someone@github)");
    expect(connectedFrom({ ...laptopAddress, pages: 1 })).toBe("from 192.168.1.23");
  });

  test("the sidebar counts the connected devices besides the one looking, and says other on a device that is one of them", () => {
    const devices = [device("phone", { ...phoneAddress, pages: 1 }), device("laptop", { ...laptopAddress, pages: 1 }), device("tablet", null)];
    expect(otherConnectedDevices(devices, null).map(({ id }) => id)).toEqual(["phone", "laptop"]);
    expect(otherConnectedDevices(devices, "phone").map(({ id }) => id)).toEqual(["laptop"]);
    expect(connectedDevicesLabel(2, false)).toBe("2 devices connected");
    expect(connectedDevicesLabel(1, true)).toBe("1 other device connected");
  });
});
