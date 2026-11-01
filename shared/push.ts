import type { NotificationKind } from "./system-notifications.ts";

/** Every push blob has this many bytes before base64, whatever it says, so neither the relay nor Apple or Google can tell pushes apart by size. */
export const PUSH_BLOB_BYTES = 2048;

export type PushPlatform = "ios" | "android";

/**
 * An alert carries a blob encrypted to the phone; a clear carries one too, telling the phone quietly which conversation's
 * notification to take away; a Live Activity's end push carries nothing of the Mac's, only a fixed placeholder.
 */
export type PushKind = "alert" | "clear" | "live-activity-end";

/** What a Mac posts to the push relay's /push. */
export interface PushRequest {
  platform: PushPlatform;
  /** The token Apple or Google gave the phone, or for a Live Activity end push the activity's own push token. */
  deviceToken: string;
  /** For iPhone builds signed for development, which Apple serves from its sandbox. */
  sandbox?: boolean;
  kind: PushKind;
  /** Base64 of exactly PUSH_BLOB_BYTES bytes, for an alert or a clear. */
  blob?: string;
}

/** What Apple's and Google's tokens look like; the Mac and the relay take only these. */
export const DEVICE_TOKEN_PATTERNS: Record<PushPlatform, RegExp> = { ios: /^[0-9a-f]{64,200}$/i, android: /^[\w:.-]{20,512}$/ };

/** What the relay answers: `gone` means the phone's token is dead, so the Mac forgets it. */
export type PushOutcome = "sent" | "gone" | "failed";

/** A phone's push key for one Mac, made on the phone and sent over its private connection to the Mac. */
export interface PushKey {
  /** 16 random bytes, base64url: the start of each blob, so the phone knows which Mac's key opens it. */
  keyId: string;
  /** A 256-bit AES-GCM key, base64url. */
  key: string;
}

/** What a blob opens to; the phone drops an id it already showed and one sent long ago, so a replayed blob shows nothing. */
export interface PushMessage {
  id: string;
  sentAt: number;
  notification: { kind: string; conversationId?: string; title: string; workspace: string; body: string };
}

/** A clear's blob: the conversation got read or answered, so the phone takes its notification away. A phone from before clears can't open it, as it has no notification. */
export interface ClearMessage {
  id: string;
  sentAt: number;
  cleared: { conversationId: string };
}

const KEY_ID_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const LENGTH_BYTES = 2;
/** The plaintext is a 2-byte big-endian length, the message's JSON, then zeros up to this many bytes. */
export const PUSH_PLAINTEXT_BYTES = PUSH_BLOB_BYTES - KEY_ID_BYTES - NONCE_BYTES - TAG_BYTES;
const LONGEST_MESSAGE_JSON = PUSH_PLAINTEXT_BYTES - LENGTH_BYTES;

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;

const ELLIPSIS = "…";
/** A text's bytes as it stands in the message's JSON, escapes and all. */
const jsonBytes = (text: string) => byteLength(JSON.stringify(text)) - 2;

function cutToJsonBytes(text: string, bytes: number) {
  if (jsonBytes(text) <= bytes) return text;
  const room = bytes - jsonBytes(ELLIPSIS);
  let used = 0;
  const kept = Array.from(text).filter((character) => (used += jsonBytes(character)) <= room);
  return kept.join("") + ELLIPSIS;
}

const CUTTABLE_FIELDS = ["body", "title", "workspace"] as const;

/** Shares the room left in the JSON among the texts, the shortest first, so no text is cut for another; titles and workspaces have no length limit of their own. */
export function fittedPushMessage(message: PushMessage): PushMessage {
  if (byteLength(JSON.stringify(message)) <= LONGEST_MESSAGE_JSON) return message;
  const emptied = { ...message, notification: { ...message.notification, body: "", title: "", workspace: "" } };
  let room = LONGEST_MESSAGE_JSON - byteLength(JSON.stringify(emptied));
  const shortestFirst = [...CUTTABLE_FIELDS].sort((one, other) => jsonBytes(message.notification[one]) - jsonBytes(message.notification[other]));
  const notification = { ...message.notification };
  shortestFirst.forEach((field, index) => {
    const share = Math.floor(room / (shortestFirst.length - index));
    notification[field] = cutToJsonBytes(message.notification[field], share);
    room -= jsonBytes(notification[field]);
  });
  return { ...message, notification };
}

const fromBase64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0));
const toBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));

const aesKey = (key: string, usage: KeyUsage) => crypto.subtle.importKey("raw", fromBase64url(key), "AES-GCM", false, [usage]);

/** Base64 of keyId | nonce | AES-256-GCM(plaintext) with the key id as additional data: always PUSH_BLOB_BYTES bytes. */
export async function sealedPushBlob({ keyId, key }: PushKey, message: PushMessage | ClearMessage, nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))): Promise<string> {
  const json = encoder.encode(JSON.stringify("notification" in message ? fittedPushMessage(message) : message));
  const plaintext = new Uint8Array(PUSH_PLAINTEXT_BYTES);
  new DataView(plaintext.buffer).setUint16(0, json.length);
  plaintext.set(json, LENGTH_BYTES);
  const keyIdBytes = fromBase64url(keyId);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: keyIdBytes }, await aesKey(key, "encrypt"), plaintext));
  return toBase64(new Uint8Array([...keyIdBytes, ...nonce, ...sealed]));
}

/** What the phone does with a blob; here for tests and the shared test vector. */
export async function openedPushBlob<Message extends PushMessage | ClearMessage = PushMessage>({ key }: PushKey, blob: string): Promise<Message> {
  const bytes = Uint8Array.from(atob(blob), (character) => character.charCodeAt(0));
  const keyIdBytes = bytes.slice(0, KEY_ID_BYTES);
  const nonce = bytes.slice(KEY_ID_BYTES, KEY_ID_BYTES + NONCE_BYTES);
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: keyIdBytes }, await aesKey(key, "decrypt"), bytes.slice(KEY_ID_BYTES + NONCE_BYTES)));
  const length = new DataView(plaintext.buffer).getUint16(0);
  return JSON.parse(new TextDecoder().decode(plaintext.slice(LENGTH_BYTES, LENGTH_BYTES + length)));
}

/** Whether a phone's push key has the sizes Mirador's blobs need. */
export const isPushKey = ({ keyId, key }: PushKey) =>
  /^[\w-]+$/.test(keyId) && /^[\w-]+$/.test(key) && fromBase64url(keyId).length === KEY_ID_BYTES && fromBase64url(key).length === 32;

/** What a phone tells a Mac, again whenever any of it changes, so the Mac can push to it while it isn't connected. */
export interface PushRegistration extends PushKey {
  platform: PushPlatform;
  deviceToken: string;
  sandbox: boolean;
  /** The notifications the phone lets through: a push it would hide still wakes it, so the Mac sends only these. */
  kinds: NotificationKind[];
}

/** Where this Mac sends pushes; the token stays on the Mac, and pages learn only whether one is set. */
export interface PushRelaySetting {
  address: string | null;
  tokenSet: boolean;
}
