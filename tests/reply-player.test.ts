import { afterEach, beforeEach, expect, test } from "bun:test";
import { sayAloud, stopReading } from "../web/reply-player.ts";

const realFetch = globalThis.fetch;
const realAudioContext = globalThis.AudioContext;

let resumes: PromiseWithResolvers<void>;
let resumeCalls: number;
let sourcesStarted: number;
let state: AudioContextState;

class SuspendedAudioContext {
  destination = {};
  get state() {
    return state;
  }
  resume() {
    resumeCalls++;
    return resumes.promise;
  }
  decodeAudioData = async () => ({});
  createBufferSource() {
    const source = {
      buffer: null as unknown,
      onended: null as (() => void) | null,
      connect: () => {},
      stop: () => {},
      start: () => {
        sourcesStarted++;
        queueMicrotask(() => source.onended?.());
      },
    };
    return source;
  }
}

beforeEach(() => {
  resumes = Promise.withResolvers<void>();
  resumeCalls = 0;
  sourcesStarted = 0;
  state = "suspended";
  globalThis.AudioContext = SuspendedAudioContext as unknown as typeof AudioContext;
  globalThis.fetch = (async () => new Response(new ArrayBuffer(8))) as unknown as typeof fetch;
});
afterEach(() => {
  state = "closed";
  globalThis.fetch = realFetch;
  globalThis.AudioContext = realAudioContext;
});

const untilResumeIsAwaited = async () => {
  while (resumeCalls < 2) await new Promise((resolve) => setTimeout(resolve, 0));
};

test("a sentence waiting for suspended audio to resume does not play once the reading was stopped", async () => {
  const heardToTheEnd = sayAloud("conversation", "reply", ["First sentence."]);
  await untilResumeIsAwaited();

  stopReading();
  state = "running";
  resumes.resolve();

  expect(await heardToTheEnd).toBe(false);
  expect(sourcesStarted).toBe(0);
});

test("a sentence plays once suspended audio resumes while the reading goes on", async () => {
  const heardToTheEnd = sayAloud("conversation", "other reply", ["First sentence."]);
  await untilResumeIsAwaited();

  state = "running";
  resumes.resolve();

  expect(await heardToTheEnd).toBe(true);
  expect(sourcesStarted).toBe(1);
});
