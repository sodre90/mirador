import type { DeviceConnection, ListedDevice, Person } from "./model.ts";
import { relativeTimeOf } from "./relative-time.ts";

export const joinedOn = (at: number, locale?: string) => new Date(at).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });

const pagesOpen = (pages: number) => (pages === 0 ? "in the background" : pages === 1 ? "1 page open" : `${pages} pages open`);

/** "connected now, 2 pages open", or "last seen 3 hours ago". */
export const deviceStatus = ({ connection, lastSeenAt }: ListedDevice) =>
  connection ? `connected now, ${pagesOpen(connection.pages)}` : `last seen ${relativeTimeOf(lastSeenAt)}`;

/** "from 100.101.5.7 (someone@github)" */
export const connectedFrom = ({ fromAddress, tailscaleUser }: DeviceConnection) => `from ${fromAddress}${tailscaleUser ? ` (${tailscaleUser})` : ""}`;

/** The owner's devices connected now, besides the one looking; people's devices are shown with the people of rooms. */
export const ownersOtherConnectedDevices = (devices: ListedDevice[], thisDeviceId: string | null, ownerId: string) =>
  devices.filter(({ id, personId, connection }) => connection !== null && id !== thisDeviceId && personId === ownerId);

/** What `mirador devices` lists: the devices that joined, and the people whose they are when not the owner's. */
export interface DevicesAndPeople {
  devices: ListedDevice[];
  people: Person[];
  ownerId: string;
}

/** "Dora, in rooms only" on a person's device; nothing on the owner's. */
export function whoseDevice({ personId }: ListedDevice, { people, ownerId }: Omit<DevicesAndPeople, "devices">) {
  if (personId === ownerId) return "";
  return `${people.find(({ id }) => id === personId)?.name || "Someone without a name"}, in rooms only`;
}
