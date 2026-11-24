import { describe, expect, test } from "bun:test";
import type { JoinedRoom, Machine, MachineStatus } from "../shared/model.ts";
import { invitedOf, joinedRoomShown } from "../web/RoomsSidebar.tsx";

const machine = (id: string, changes: Partial<Machine> = {}): Machine => ({
  id,
  name: id,
  origin: `https://${id}.example.ts.net`,
  createdAt: 1,
  relayPort: 4620,
  joined: true,
  color: null,
  hostId: null,
  outOfRooms: false,
  asPerson: true,
  relayKey: null,
  peerToPeer: false,
  knocks: [],
  ownerName: null,
  ...changes,
});

const listed = (id: string): JoinedRoom => ({ id, name: id, unread: 0, mentions: 0, toConfirm: 0, toApprove: 0, muted: false });

const statusOf = (machineId: string, rooms: JoinedRoom[]): MachineStatus => ({ machineId, reachable: true, waiting: [], joinedThere: [], rooms, mutedHere: [] });

describe("what someone else's machines have for this computer's owner", () => {
  const anns = machine("anns");
  const ownServer = machine("own-server", { asPerson: false });
  const signedOut = machine("signed-out", { joined: false, outOfRooms: true });
  const atTheDoor = machine("at-the-door", { joined: false, knocks: [{ roomId: "orchard", turnedAway: false }] });
  const statuses = [statusOf("anns", [listed("garden"), listed("shed")]), statusOf("own-server", [listed("mine")])];
  const invited = invitedOf([ownServer, anns, signedOut, atTheDoor], statuses);

  test("is the rooms they are in there, the doors they wait at, and the machines a new invite brings back, and nothing of their own machines", () => {
    expect(invited.joinedRooms.map(({ machine, room }) => [machine.id, room.id])).toEqual([
      ["anns", "garden"],
      ["anns", "shed"],
    ]);
    expect(invited.knocks.map(({ machine, knock }) => [machine.id, knock.roomId])).toEqual([["at-the-door", "orchard"]]);
    expect(invited.machinesToComeBackTo.map(({ id }) => id)).toEqual(["signed-out"]);
  });

  test("shows the room picked, or the first of a machine opened without one", () => {
    const shown = (machineId: string, roomId: string | null) => joinedRoomShown({ machineId, roomId }, invited.joinedRooms)?.room.id;
    expect([shown("anns", "shed"), shown("anns", null), shown("anns", "left"), shown("signed-out", null)]).toEqual(["shed", "garden", undefined, undefined]);
    expect(joinedRoomShown(null, invited.joinedRooms)).toBeUndefined();
  });
});
