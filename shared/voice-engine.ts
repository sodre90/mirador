import type { EngineService } from "./voice-engine-models.ts";
import type { HostProblem } from "./host-problems.ts";

/** What setting up voice on this Mac is doing, in order. */
export type VoiceEngineStep = "space" | "uv" | "python" | "packages" | "models";

/** Mirador's own speech engine on this Mac: speech recognition and Kokoro, and a voice model if the user wants one. */
export type VoiceEngineSetup =
  | { state: "unsupported"; reason: string }
  | { state: "not-set-up" }
  /** done and total count bytes while downloading; both 0 while a step can't tell how far it is. models are the ones it downloads, by id. */
  | { state: "setting-up"; step: VoiceEngineStep; done: number; total: number; models: string[] }
  | { state: "failed"; problem: string; problemAbout?: HostProblem }
  /** notAdded says which models, by id, adding failed for, and why; what was set up before still works. */
  | { state: "set-up"; bytesOnDisk: number; notAdded?: { models: string[]; problem: string; problemAbout?: HostProblem } };

/** Each server's state, kept apart from setup: stopped servers load again the next time they're needed. */
export type EngineServer = "speech" | "voiceModel" | "speaking";

/** Speaking replies has a server of its own, so that dictating never waits for Whisper to load again. */
export const SERVER_OF: Record<EngineService, EngineServer> = { recognition: "speech", voiceModel: "voiceModel", speaking: "speaking" };
export type EngineServerState = "stopped" | "loading" | "ready";

export interface VoiceEngineStatus {
  setup: VoiceEngineSetup;
  servers: Record<EngineServer, EngineServerState>;
  /** The models the servers may use, by id, kept while setup adds others. */
  onDisk: string[];
  /** This Mac's, which tells the models that fit it. */
  memoryBytes: number;
}

export const gigabytes = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;
