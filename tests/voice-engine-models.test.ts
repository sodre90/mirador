import { describe, expect, test } from "bun:test";
import type { VoiceEngineSetup, VoiceEngineStatus } from "../shared/voice-engine.ts";
import { bestFitting, choosableModel, choosableModels, memoryNeededGb, modelsFor } from "../shared/voice-engine-models.ts";
import { modelChoice, modelOffer, modelState, tooLittleMemoryForVoiceModel } from "../web/voice-models.ts";

const gigabytesOfMemory = (size: number) => size * 2 ** 30;

describe("the models of this Mac's engine", () => {
  test("a Mac gets the best voice model that holds at most half its memory, and an 8 GB Mac none", () => {
    const picked = [8, 16, 18, 24, 32, 36, 64].map((size) => [size, bestFitting("voiceModel", gigabytesOfMemory(size))?.name ?? null]);
    expect(Object.fromEntries(picked)).toEqual({
      8: null,
      16: "Gemma 4 E4B",
      18: "Gemma 4 12B",
      24: "Gemma 4 12B",
      32: "Gemma 4 26B-A4B",
      36: "Gemma 4 26B-A4B",
      64: "Gemma 4 26B-A4B",
    });
    expect(bestFitting("recognition", gigabytesOfMemory(8))?.name).toBe("Whisper large-v3 turbo");
  });

  test("each tells the least memory a Mac comes with that it fits", () => {
    expect(modelsFor("voiceModel").map((model) => [model.name, memoryNeededGb(model)])).toEqual([
      ["Gemma 4 26B-A4B", 32],
      ["Gemma 4 12B", 18],
      ["Gemma 4 E4B", 16],
    ]);
  });

  test("each has an id of its own and is pinned to a commit", () => {
    expect(new Set(choosableModels.map(({ id }) => id)).size).toBe(choosableModels.length);
    expect(choosableModels.every(({ revision }) => /^[0-9a-f]{40}$/.test(revision))).toBe(true);
  });

  test("a choice says how good it is and what it downloads, or how much memory a Mac needs for it", () => {
    const [best] = modelsFor("voiceModel");
    expect(modelChoice(best!, gigabytesOfMemory(64))).toBe("Gemma 4 26B-A4B · best · 15.4 GB");
    expect(modelChoice(best!, gigabytesOfMemory(16))).toBe("Gemma 4 26B-A4B · best · needs a Mac with 32 GB of memory");
    expect(modelChoice(modelsFor("recognition")[0]!, gigabytesOfMemory(8)), "a model not compared yet has no hint").toBe("Whisper large-v3 turbo · 1.6 GB");
    expect(tooLittleMemoryForVoiceModel(gigabytesOfMemory(8))).toBe(
      "This Mac's 8 GB of memory is too little for a voice model of its own. A profile's API or a server of your own can translate, set below.",
    );
  });

  test("a model offered for this Mac says what it downloads only while it isn't here yet", () => {
    const smallGemma = choosableModel("gemma-4-12b")!;
    expect(modelOffer(smallGemma, { onDisk: ["gemma-4-12b"], memoryBytes: gigabytesOfMemory(64) })).toBe("Gemma 4 12B · good");
    expect(modelOffer(smallGemma, { onDisk: [], memoryBytes: gigabytesOfMemory(64) })).toBe("Gemma 4 12B · good · 6.8 GB");
    expect(modelOffer(choosableModel("omnivoice")!, { onDisk: [], memoryBytes: gigabytesOfMemory(64) })).toBe("OmniVoice · non-commercial use only · 2.0 GB");
  });
});

describe("what shows beside a model chosen for this Mac", () => {
  const omniVoice = choosableModel("omnivoice")!;
  const engine = (setup: VoiceEngineSetup, { onDisk = ["kokoro-82m"], memoryGb = 64 } = {}): VoiceEngineStatus => ({
    setup,
    servers: { speech: "ready", voiceModel: "stopped", speaking: "loading" },
    onDisk,
    memoryBytes: gigabytesOfMemory(memoryGb),
  });
  const setUp: VoiceEngineSetup = { state: "set-up", bytesOnDisk: 1 };
  const downloading = (models: string[]): Extract<VoiceEngineSetup, { state: "setting-up" }> => ({ state: "setting-up", step: "models", done: 1, total: 2, models });

  test("on this Mac, how its own server is", () => {
    expect(modelState(omniVoice, engine(setUp, { onDisk: ["kokoro-82m", "omnivoice"] }))).toEqual({ is: "on-disk", server: "loading" });
    expect(modelState(choosableModel("whisper-large-v3-turbo")!, engine(setUp, { onDisk: ["whisper-large-v3-turbo"] }))).toEqual({ is: "on-disk", server: "ready" });
  });

  test("its download, how far it is while it runs, and why it failed the last time", () => {
    expect(modelState(omniVoice, engine(setUp))).toEqual({ is: "downloadable", problem: null });
    expect(modelState(omniVoice, engine(downloading(["omnivoice"])))).toEqual({ is: "downloading", setup: downloading(["omnivoice"]) });
    expect(modelState(omniVoice, engine(downloading(["gemma-4-12b"]))), "setup downloads one set of models at a time").toEqual({ is: "waiting-for-another-download" });
    const failed: VoiceEngineSetup = { ...setUp, notAdded: { models: ["omnivoice"], problem: "Adding OmniVoice failed." } };
    expect(modelState(omniVoice, engine(failed))).toEqual({ is: "downloadable", problem: "Adding OmniVoice failed." });
    expect(modelState(choosableModel("gemma-4-12b")!, engine(failed)), "a failure is told beside the model it was for").toEqual({ is: "downloadable", problem: null });
  });

  test("on a Mac with too little memory for it, how much it needs, even while another download runs", () => {
    expect(modelState(omniVoice, engine(setUp, { memoryGb: 16 }))).toEqual({ is: "too-big", neededGb: 18 });
    expect(modelState(omniVoice, engine(downloading(["gemma-4-e4b"]), { memoryGb: 16 }))).toEqual({ is: "too-big", neededGb: 18 });
  });
});
