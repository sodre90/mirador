import { describe, expect, test } from "bun:test";
import { toneWav, wavFile } from "../e2e/wav.ts";
import { mp3Of, speechIn } from "../host/voice/mp3.ts";

/** A WAV of float samples, as some servers write, with a chunk of odd length of their own before the sound. */
function floatStereoWav(frames: [number, number][], rate: number) {
  const dataAt = 48;
  const wav = Buffer.alloc(dataAt + 8 + frames.length * 8);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(3, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 8, 28);
  wav.writeUInt16LE(8, 32);
  wav.writeUInt16LE(32, 34);
  wav.write("LIST", 36);
  wav.writeUInt32LE(3, 40);
  wav.write("odd", 44);
  wav.write("data", dataAt);
  wav.writeUInt32LE(frames.length * 8, dataAt + 4);
  frames.forEach(([left, right], index) => {
    wav.writeFloatLE(left, dataAt + 8 + index * 8);
    wav.writeFloatLE(right, dataAt + 12 + index * 8);
  });
  return new Uint8Array(wav);
}

const withDataSize = (wav: Uint8Array, size: number) => {
  const copy = Buffer.from(wav);
  copy.writeUInt32LE(size, 40);
  return new Uint8Array(copy);
};

/** MPEG audio frames start with eleven set bits. */
const startsWithAnMp3Frame = (mp3: Uint8Array) => mp3[0] === 0xff && (mp3[1]! & 0xe0) === 0xe0;

describe("reading the WAV a speech server answers", () => {
  test("reads 16-bit samples, and float samples mixed down to one channel past a chunk of the server's own", () => {
    expect(speechIn(new Uint8Array(wavFile([0.5, -0.5, 0], 24_000)))).toEqual({ sampleRate: 24_000, samples: Float32Array.from([0.5, -16383 / 32768, 0]) });
    expect(speechIn(floatStereoWav([[0.5, 0.25], [-1, 1]], 22_050))).toEqual({ sampleRate: 22_050, samples: Float32Array.from([0.375, 0]) });
  });

  test("takes the rest of the file as the sound when a streamed header left its length unset, and no half sample", () => {
    const wav = new Uint8Array(wavFile([0.5, -0.5], 24_000));
    expect(speechIn(withDataSize(wav, 0xffffffff)).samples).toHaveLength(2);
    expect(speechIn(withDataSize(wav, 0)).samples).toHaveLength(2);
    expect(speechIn(new Uint8Array([...wav, 7])).samples, "a byte past the last sample").toHaveLength(2);
  });

  test("says what is wrong with an answer that isn't WAV, holds no sound, or has samples of another kind", () => {
    expect(() => speechIn(new Uint8Array([82, 73, 70, 70]))).toThrow("The reply voice server's answer isn't WAV.");
    expect(() => speechIn(new Uint8Array(wavFile([], 24_000)))).toThrow("The reply voice server answered without sound.");
    const eightBit = Buffer.from(wavFile([0.5], 24_000));
    eightBit.writeUInt16LE(8, 34);
    expect(() => speechIn(new Uint8Array(eightBit))).toThrow("(format 1, 8-bit); 16-bit or float samples are.");
  });
});

describe("speech as MP3", () => {
  test("is a seventh of the WAV's size or less, and starts with an MP3 frame", async () => {
    const wav = new Uint8Array(toneWav(2));
    const mp3 = await mp3Of(wav);
    expect(startsWithAnMp3Frame(mp3)).toBe(true);
    expect(mp3.length).toBeLessThan(wav.length / 7);
    expect(mp3.length, "48 kbit/s for two seconds").toBeGreaterThan(48_000 / 8);
  });

  test("two sentences encoded at once each come out as alone", async () => {
    const [short, long] = [new Uint8Array(toneWav(0.5)), new Uint8Array(toneWav(1.5, 16_000))];
    const [shortAlone, longAlone] = [await mp3Of(short), await mp3Of(long)];
    expect(await Promise.all([mp3Of(short), mp3Of(long)])).toEqual([shortAlone, longAlone]);
  });
});
