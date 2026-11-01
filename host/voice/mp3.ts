import { createMp3Encoder, type WasmMediaEncoder } from "wasm-media-encoders";
import { HostProblemError } from "../../shared/host-problems.ts";

/** Speech at 48 kbit/s is about a seventh of the 24 kHz WAV speech servers answer, and every page and phone plays MP3. */
const SPEECH_KILOBITS_PER_SECOND = 48;

const PCM = 1;
const FLOAT = 3;
const EXTENSIBLE = 0xfffe;
/** A server streaming WAV writes its header before it knows the length. */
const UNKNOWN_LENGTHS = [0, 0xffffffff];

/** Mixed down to one channel, as speech needs no more. */
export interface Speech {
  sampleRate: number;
  samples: Float32Array;
}

interface Format {
  code: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
}

let encoder: Promise<WasmMediaEncoder<"audio/mpeg">> | null = null;

interface Chunk {
  id: string;
  start: number;
  size: number;
}

function* chunksIn(wav: Uint8Array, view: DataView): Generator<Chunk> {
  for (let at = 12; at + 8 <= wav.byteLength; ) {
    const size = view.getUint32(at + 4, true);
    yield { id: tagAt(wav, at), start: at + 8, size };
    at += 8 + size + (size % 2);
  }
}

const tagAt = (wav: Uint8Array, at: number) => String.fromCharCode(...wav.subarray(at, at + 4));

/** The sound of a WAV file, read chunk by chunk, as servers put other chunks before its samples. */
export function speechIn(wav: Uint8Array): Speech {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  if (wav.byteLength < 12 || tagAt(wav, 0) !== "RIFF" || tagAt(wav, 8) !== "WAVE") throw new HostProblemError({ code: "reply-voice-not-wav" });
  const chunks = [...chunksIn(wav, view)];
  const fmt = chunks.find(({ id }) => id === "fmt ");
  const data = chunks.find(({ id }) => id === "data");
  if (!data) throw new HostProblemError({ code: "reply-voice-wav-without-sound" });
  if (!fmt) throw new HostProblemError({ code: "reply-voice-wav-without-format" });
  const format = formatAt(view, fmt.start, fmt.size);
  const end = UNKNOWN_LENGTHS.includes(data.size) ? wav.byteLength : Math.min(data.start + data.size, wav.byteLength);
  const samples = mixedDown(view, data.start, end, format);
  if (samples.length === 0) throw new HostProblemError({ code: "reply-voice-answered-without-sound" });
  return { sampleRate: format.sampleRate, samples };
}

function formatAt(view: DataView, at: number, size: number): Format {
  const declared = view.getUint16(at, true);
  return {
    code: declared === EXTENSIBLE && size >= 26 ? view.getUint16(at + 24, true) : declared,
    channels: view.getUint16(at + 2, true),
    sampleRate: view.getUint32(at + 4, true),
    bitsPerSample: view.getUint16(at + 14, true),
  };
}

function sampleReader({ code, bitsPerSample }: Format) {
  if (code === PCM && bitsPerSample === 16) return (view: DataView, at: number) => view.getInt16(at, true) / 32768;
  if (code === FLOAT && bitsPerSample === 32) return (view: DataView, at: number) => view.getFloat32(at, true);
  throw new HostProblemError({ code: "reply-voice-wav-unreadable", format: code, bits: bitsPerSample });
}

function mixedDown(view: DataView, start: number, end: number, format: Format) {
  const sampleAt = sampleReader(format);
  const bytesPerSample = format.bitsPerSample / 8;
  const frameBytes = bytesPerSample * format.channels;
  const frames = Math.floor((end - start) / frameBytes);
  return Float32Array.from({ length: frames }, (_, frame) => {
    const at = start + frame * frameBytes;
    const channels = Array.from({ length: format.channels }, (_, channel) => sampleAt(view, at + channel * bytesPerSample));
    return channels.reduce((sum, sample) => sum + sample, 0) / format.channels;
  });
}

/**
 * Speech servers answer WAV, as this Mac's speech engine writes nothing else without ffmpeg. One encoder serves every
 * request: it is configured, fed and flushed without awaiting in between, so two requests never share its state.
 */
export async function mp3Of(wav: Uint8Array) {
  const { sampleRate, samples } = speechIn(wav);
  const shared = await (encoder ??= createMp3Encoder());
  shared.configure({ sampleRate, channels: 1, bitrate: SPEECH_KILOBITS_PER_SECOND });
  const body = shared.encode([samples]).slice();
  const tail = shared.finalize().slice();
  const mp3 = new Uint8Array(body.length + tail.length);
  mp3.set(body);
  mp3.set(tail, body.length);
  return mp3;
}
