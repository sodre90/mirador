import type { TerminalSplit } from "../shared/protocol.ts";
import { waitingRequest } from "./waiting-request.ts";

/** What the palette and the keys ask of the terminal pane, which may first have to be shown. */
export type TerminalPaneRequest = { type: "new-tab" } | { type: "split"; axis: TerminalSplit["axis"] } | { type: "focus" };

const paneRequests = waitingRequest<TerminalPaneRequest>();

export const requestOfTerminalPane = paneRequests.request;
export const takeTerminalPaneRequest = paneRequests.take;
export const useTerminalPaneRequest = paneRequests.useWaiting;
