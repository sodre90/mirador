export const PAUSE_ENDS_MS = 2_500;
export const NOTHING_HEARD_MS = 8_000;
/** Keeping a spoken conversation going leaves time to think before speaking; "stop" or Esc ends it sooner. */
export const KEEP_TALKING_WAIT_MS = 120_000;
/** The quietest level counted as speech, as an RMS of samples from -1 to 1, whatever the room's noise. */
const LEAST_SPEECH_LEVEL = 0.015;
const SPEECH_OVER_NOISE = 3;
const NOISE_FLOOR_RISE = 0.01;

/** Kept around the speech heard, so that its first and last sounds, quieter than the level counted as speech, stay in. */
const SPEECH_MARGIN_MS = 500;

export type PauseVerdict = "go-on" | "paused" | "nothing-heard";

/** Where speech was heard, in milliseconds since listening began. */
export interface SpeechSpan {
  fromMs: number;
  toMs: number;
}

export interface PauseWatch {
  hear(level: number, now: number): PauseVerdict;
  heardSpeech(): boolean;
  /** Only this part of the recording goes to speech recognition: the silence and noise around it give it less to make words up from. */
  speechSpan(): SpeechSpan | null;
}

/**
 * Tells from the microphone's level when the user has stopped talking. The room's noise floor follows a quieter level
 * at once but a louder one only slowly, so that speech doesn't become the floor.
 */
export function pauseWatch(startedAt: number, nothingHeardMs = NOTHING_HEARD_MS): PauseWatch {
  let noiseFloor = Infinity;
  let firstSpeechAt: number | null = null;
  let lastSpeechAt: number | null = null;
  return {
    hear(level, now) {
      noiseFloor = level < noiseFloor ? level : noiseFloor + (level - noiseFloor) * NOISE_FLOOR_RISE;
      if (level > Math.max(LEAST_SPEECH_LEVEL, noiseFloor * SPEECH_OVER_NOISE)) {
        firstSpeechAt ??= now;
        lastSpeechAt = now;
      }
      if (lastSpeechAt === null) return now - startedAt >= nothingHeardMs ? "nothing-heard" : "go-on";
      return now - lastSpeechAt >= PAUSE_ENDS_MS ? "paused" : "go-on";
    },
    heardSpeech: () => lastSpeechAt !== null,
    speechSpan: () =>
      firstSpeechAt === null || lastSpeechAt === null ? null : { fromMs: Math.max(0, firstSpeechAt - startedAt - SPEECH_MARGIN_MS), toMs: lastSpeechAt - startedAt + SPEECH_MARGIN_MS },
  };
}
