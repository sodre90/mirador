import { t } from "./i18n/index.ts";
import { storedChoice } from "./stored-choice.ts";

const inSidebar = storedChoice<"shown" | "hidden">("mirador-connected-devices-in-sidebar", ["shown", "hidden"], "shown");

export const useConnectedDevicesInSidebar = () => inSidebar.use() === "shown";
export const setConnectedDevicesInSidebar = (shown: boolean) => inSidebar.set(shown ? "shown" : "hidden");

/** "2 devices connected"; on a joined device, which is connected itself, "1 other device connected". */
export const connectedDevicesLabel = (count: number, lookingFromAJoinedDevice: boolean) =>
  lookingFromAJoinedDevice ? t.shell.sidebar.otherDevicesConnected(count) : t.shell.sidebar.connectedDevices(count);
