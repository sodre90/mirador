import { isDeepStrictEqual } from "node:util";
import { CUSTOM_ORDER } from "../../shared/conversation-order.ts";
import { HostProblemError } from "../../shared/host-problems.ts";
import { DEFAULT_CONVERSATIONS_SHOWN, DEFAULT_OLDER_AFTER, DEFAULT_SIDE_CHAT_ACCESS } from "../../shared/model.ts";
import { DEFAULT_MORNING_MINUTES } from "../../shared/reminders.ts";
import type { FilePreferences, FileProfileReference, FileVoiceSettings, SettingsItem } from "../../shared/settings-file.ts";
import { defaultVoiceSettings, type CustomEndpoint, type VoiceSettings } from "../../shared/voice.ts";
import type { Store } from "../store.ts";
import { profileReferredTo, referredName, type ImportContext, type ImportStep } from "./import-step.ts";
import { isNeedsValue } from "./read-settings-file.ts";

type PlainPreferences = Required<Omit<FilePreferences, "voice">>;

type PlainWriters = { [Key in keyof PlainPreferences]: (value: PlainPreferences[Key]) => void };

/** Saves a preference with the checks it has in Settings, and shows it on every page. */
export type PreferenceWriters = PlainWriters & { voice: (settings: VoiceSettings) => void };

interface Preference<Value> {
  here: (store: Store) => Value;
  fallback: Value;
}

const plainPreferences: { [Key in keyof PlainPreferences]: Preference<PlainPreferences[Key]> } = {
  canvasUse: { here: (store) => store.canvasUse(), fallback: "often" },
  keepDeletedCanvas: { here: (store) => store.keepDeletedCanvas(), fallback: "30-days" },
  keepAwake: { here: (store) => store.keepAwake(), fallback: "never" },
  reminderMorning: { here: (store) => store.reminderMorning(), fallback: DEFAULT_MORNING_MINUTES },
  olderAfter: { here: (store) => store.olderAfter(), fallback: DEFAULT_OLDER_AFTER },
  conversationsShown: { here: (store) => store.conversationsShown(), fallback: DEFAULT_CONVERSATIONS_SHOWN },
  sideChatAccess: { here: (store) => store.sideChatAccess(), fallback: DEFAULT_SIDE_CHAT_ACCESS },
  roomInvitesConnect: { here: (store) => store.roomInvitesConnect(), fallback: "peer-to-peer" },
  conversationOrder: { here: (store) => store.chosenConversationOrder(), fallback: CUSTOM_ORDER },
  pluginUpdateMode: { here: (store) => store.pluginUpdateMode(), fallback: "ask" },
};

export function preferenceSteps(preferences: FilePreferences, context: ImportContext, writers: PreferenceWriters): ImportStep[] {
  const { voice, ...inFile } = preferences;
  const plainWriters: PlainWriters = writers;
  const plainStep = <Key extends keyof PlainPreferences>(key: Key): ImportStep[] => {
    const value = inFile[key] as PlainPreferences[Key] | undefined;
    if (value === undefined) return [];
    const { here, fallback } = plainPreferences[key];
    return [{ item: itemOf(key, value, here(context.store), fallback, []), bringIn: () => plainWriters[key](value) }];
  };
  const plain = (Object.keys(plainPreferences) as (keyof PlainPreferences)[]).flatMap((key) => plainStep(key));
  return [...plain, ...(voice ? [voiceStep(voice, context.store, writers)] : [])];
}

/** One that still has its default is overwritten without asking, as nobody chose it. */
function itemOf(key: keyof FilePreferences, inFile: unknown, here: unknown, fallback: unknown, needs: string[]): SettingsItem {
  const state = isDeepStrictEqual(inFile, here) ? "same" : isDeepStrictEqual(here, fallback) ? "new" : "different";
  return { id: `preference ${key}`, kind: "preference", name: key, state, differs: [], needs };
}

function voiceStep(inFile: FileVoiceSettings, store: Store, writers: PreferenceWriters): ImportStep {
  const here = store.voiceSettings();
  const planned = voiceSettingsFrom(inFile, here, store);
  return {
    item: itemOf("voice", planned.missingProfile === null ? planned.settings : inFile, here, defaultVoiceSettings, planned.needs),
    bringIn: () => {
      const { settings, missingProfile } = voiceSettingsFrom(inFile, store.voiceSettings(), store);
      if (missingProfile !== null) throw new HostProblemError({ code: "settings-profile-missing", neededBy: "voice", profile: referredName(missingProfile) });
      writers.voice(settings);
    },
  };
}

type EndpointPart = "recognition" | "voiceModel" | "replyVoice";

function voiceSettingsFrom(inFile: FileVoiceSettings, here: VoiceSettings, store: Store): { settings: VoiceSettings; needs: string[]; missingProfile: FileProfileReference | null } {
  const needs: string[] = [];
  const endpointOf = (part: EndpointPart, { url, model, apiKey = "" }: Extract<FileVoiceSettings["recognition"], { kind: "custom" }>["endpoint"]): CustomEndpoint => {
    if (!isNeedsValue(apiKey)) return { url, model, apiKey };
    const keyHere = keyOf(here[part], url);
    if (!keyHere) needs.push(`${part}: apiKey`);
    return { url, model, apiKey: keyHere };
  };
  const { recognition, voiceModel, replyVoice } = inFile;
  const named = voiceModel.kind === "profile" ? profileReferredTo(store, voiceModel.profile) : undefined;
  const known = Object.keys(defaultVoiceSettings).filter((key) => Object.hasOwn(inFile, key));
  const settings: VoiceSettings = {
    ...defaultVoiceSettings,
    ...Object.fromEntries(known.map((key) => [key, inFile[key as keyof FileVoiceSettings]])),
    recognition: recognition.kind === "custom" ? { kind: "custom", endpoint: endpointOf("recognition", recognition.endpoint) } : recognition,
    voiceModel:
      voiceModel.kind === "custom"
        ? { ...voiceModel, endpoint: endpointOf("voiceModel", voiceModel.endpoint) }
        : voiceModel.kind === "profile"
          ? { kind: "profile", profileId: named?.id ?? "", model: voiceModel.model }
          : voiceModel,
    replyVoice: replyVoice.kind === "custom" ? { ...replyVoice, endpoint: endpointOf("replyVoice", replyVoice.endpoint) } : replyVoice,
  };
  return { settings, needs, missingProfile: voiceModel.kind === "profile" && !named ? voiceModel.profile : null };
}

/** The key here for the same server, so a file that leaves it out doesn't take it away. */
const keyOf = (source: VoiceSettings[EndpointPart], url: string) => (source.kind === "custom" && source.endpoint.url === url ? source.endpoint.apiKey : "");
