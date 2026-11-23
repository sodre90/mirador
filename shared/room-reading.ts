import { cutWithEllipsis } from "./text-cut.ts";
import { oneLine, shownAsWritten } from "./written-text.ts";

/** How far you have read a room, and what in it waits for you. */
export interface RoomReading {
  roomId: string;
  /** Messages shown in the room since the last you read there, but your own. */
  unread: number;
  /** Of the messages since then, those that tag you. */
  mentions: number;
  /** Its agents' questions that wait for you to confirm their answer. */
  toConfirm: number;
  /** Nothing in it notifies you; it still counts what you have not read. */
  muted: boolean;
}

/**
 * Why a room calls you while you look elsewhere: someone tagged you, or a question waits for you to confirm its answer;
 * for its owner alone, someone an invite let knock waits for them to let them in.
 */
export type RoomAlert = { about: "mention"; by: string; text: string } | { about: "confirm"; question: string } | { about: "knock"; by: string };

export const ROOM_ALERT_KINDS = ["mention", "confirm"] as const satisfies readonly RoomAlert["about"][];

/** The most of a message or question an alert says, so that it fits on a notification. */
export const ROOM_ALERT_TEXT_MOST = 120;

/** Text as an alert shows it, on either machine: as everyone reads it, on one line, cut short. */
export const alertText = (text: string) => cutWithEllipsis(oneLine(shownAsWritten(text)), ROOM_ALERT_TEXT_MOST);

/** The most a count of a room shows; another machine's larger ones are taken as this. */
export const MOST_COUNTED = 999;

/** A count from another machine, made one: a whole number from 0 to MOST_COUNTED, anything else 0. */
export const countFrom = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? Math.min(value, MOST_COUNTED) : 0);

export const isMuted = (readings: RoomReading[], roomId: string) => readings.some((reading) => reading.roomId === roomId && reading.muted);
