import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The instruments and effects the score (compose.ts) is made of, synthesised from plain arithmetic so there is no sample
 * or track to licence. Everything is deterministic: the noise is seeded, so the same score comes out on every run.
 */

export const RATE = 48_000;
export type Stereo = { left: Float32Array; right: Float32Array };
type Curve = number | ((t: number) => number);
const curve = (value: Curve) => (typeof value === "number" ? () => value : value);

function seededNoise(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}
export const noise = seededNoise(1729);
export const midi = (note: number) => 440 * 2 ** ((note - 69) / 12);
export const samples = (seconds: number) => Math.max(1, Math.ceil(seconds * RATE));

export function render(seconds: number, sample: (t: number) => number) {
  return Float32Array.from({ length: samples(seconds) }, (_, index) => sample(index / RATE));
}

export const envelope = (t: number, length: number, attack: number, release: number) => Math.min(1, t / attack) * Math.min(1, Math.max(0, (length - t) / release));

const panGains = (pan: number) => [Math.cos(((pan + 1) * Math.PI) / 4), Math.sin(((pan + 1) * Math.PI) / 4)] as const;

export class Mix implements Stereo {
  readonly left: Float32Array;
  readonly right: Float32Array;
  constructor(seconds: number) {
    this.left = new Float32Array(samples(seconds));
    this.right = new Float32Array(samples(seconds));
  }
  add(at: number, sound: Float32Array, gain: number, pan = 0) {
    const [leftGain, rightGain] = panGains(pan);
    this.addChannels(at, sound, sound, gain * leftGain, gain * rightGain);
  }
  addStereo(at: number, { left, right }: Stereo, gain: number) {
    this.addChannels(at, left, right, gain, gain);
  }
  private addChannels(at: number, left: Float32Array, right: Float32Array, leftGain: number, rightGain: number) {
    const start = Math.round(at * RATE);
    const from = Math.max(0, -start);
    const to = Math.min(left.length, this.left.length - start);
    for (let index = from; index < to; index++) {
      this.left[start + index]! += left[index]! * leftGain;
      this.right[start + index]! += right[index]! * rightGain;
    }
  }
}

/** A score's buses: dry, a sidechain-pumped bus, a reverb send and a ping-pong delay send. */
export class Buses {
  readonly dry: Mix;
  readonly pumped: Mix;
  readonly verb: Mix;
  readonly delay: Mix;
  private readonly kicks: number[] = [];
  constructor(readonly seconds: number) {
    this.dry = new Mix(seconds);
    this.pumped = new Mix(seconds);
    this.verb = new Mix(seconds);
    this.delay = new Mix(seconds);
  }
  add(at: number, sound: Float32Array | Stereo, gain: number, { pan = 0, verb = 0, delay = 0, pump = false } = {}) {
    const target = pump ? this.pumped : this.dry;
    const place = (mix: Mix, level: number) => (sound instanceof Float32Array ? mix.add(at, sound, level, pan) : mix.addStereo(at, sound, level));
    place(target, gain);
    if (verb > 0) place(this.verb, gain * verb);
    if (delay > 0) place(this.delay, gain * delay);
  }
  /** Marks where the pumped bus ducks, as under a kick, whether or not a kick sounds there. */
  pumpAt(...times: number[]) {
    this.kicks.push(...times);
  }
  bounce({ depth = 0.6, release = 0.22, room = 0.86, damp = 0.35, delaySeconds = 0.3, feedback = 0.38 } = {}) {
    const out = new Mix(this.seconds);
    out.addStereo(0, this.dry, 1);
    out.addStereo(0, pump(this.pumped, this.kicks, depth, release), 1);
    out.addStereo(0, pingPong(this.delay, delaySeconds, feedback), 1);
    out.addStereo(0, freeverb(this.verb, room, damp), 1);
    return out;
  }
}

function polyBlep(phase: number, step: number) {
  if (phase < step) {
    const t = phase / step;
    return t + t - t * t - 1;
  }
  if (phase > 1 - step) {
    const t = (phase - 1) / step;
    return t * t + t + t + 1;
  }
  return 0;
}

export function saw(frequency: Curve, seconds: number, phase = 0) {
  const at = curve(frequency);
  const out = new Float32Array(samples(seconds));
  for (let index = 0; index < out.length; index++) {
    const step = at(index / RATE) / RATE;
    out[index] = 2 * phase - 1 - polyBlep(phase, step);
    phase += step;
    if (phase >= 1) phase -= 1;
  }
  return out;
}

export function pulse(frequency: Curve, seconds: number, width = 0.5, phase = 0) {
  const at = curve(frequency);
  const out = new Float32Array(samples(seconds));
  for (let index = 0; index < out.length; index++) {
    const step = at(index / RATE) / RATE;
    const shifted = (phase + width) % 1;
    out[index] = 2 * phase - 1 - polyBlep(phase, step) - (2 * shifted - 1 - polyBlep(shifted, step));
    phase += step;
    if (phase >= 1) phase -= 1;
  }
  return out;
}

/** A state-variable filter (Zavalishin's topology-preserving form) with a cutoff that can move. */
export function svf(sound: Float32Array, cutoff: Curve, q = 0.707, mode: "low" | "band" | "high" = "low") {
  const at = curve(cutoff);
  const out = new Float32Array(sound.length);
  const damping = 1 / q;
  let first = 0;
  let second = 0;
  let a1 = 0;
  let a2 = 0;
  let a3 = 0;
  for (let index = 0; index < sound.length; index++) {
    if (index % 8 === 0) {
      const g = Math.tan((Math.PI * Math.min(RATE * 0.45, Math.max(20, at(index / RATE)))) / RATE);
      a1 = 1 / (1 + g * (g + damping));
      a2 = g * a1;
      a3 = g * a2;
    }
    const v3 = sound[index]! - second;
    const v1 = a1 * first + a2 * v3;
    const v2 = second + a2 * first + a3 * v3;
    first = 2 * v1 - first;
    second = 2 * v2 - second;
    out[index] = mode === "low" ? v2 : mode === "band" ? v1 : sound[index]! - damping * v1 - v2;
  }
  return out;
}

export const lowpass = (sound: Float32Array, cutoff: Curve, q = 0.707) => svf(sound, cutoff, q, "low");
export const highpass = (sound: Float32Array, cutoff: Curve, q = 0.707) => svf(sound, cutoff, q, "high");
export const bandpass = (sound: Float32Array, cutoff: Curve, q = 1) => svf(sound, cutoff, q, "band");

export function shape(sound: Float32Array, gain: (t: number) => number) {
  return sound.map((sample, index) => sample * gain(index / RATE));
}

export function sum(...sounds: Float32Array[]) {
  const out = new Float32Array(Math.max(...sounds.map((sound) => sound.length)));
  sounds.forEach((sound) => sound.forEach((sample, index) => (out[index]! += sample)));
  return out;
}

export const reversed = (sound: Float32Array) => sound.slice().reverse();

export function stereoMap({ left, right }: Stereo, map: (channel: Float32Array) => Float32Array): Stereo {
  return { left: map(left), right: map(right) };
}

function freeverb(input: Stereo, room: number, damp: number): Stereo {
  const scale = RATE / 44_100;
  const length = input.left.length;
  const feedback = room * 0.28 + 0.7;
  const damping = damp * 0.4;
  const channel = (spread: number) => {
    const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((size) => ({ buffer: new Float32Array(Math.round((size + spread) * scale)), index: 0, store: 0 }));
    const allpasses = [556, 441, 341, 225].map((size) => ({ buffer: new Float32Array(Math.round((size + spread) * scale)), index: 0 }));
    const out = new Float32Array(length);
    for (let index = 0; index < length; index++) {
      const sample = (input.left[index]! + input.right[index]!) * 0.015;
      let wet = 0;
      for (const comb of combs) {
        const delayed = comb.buffer[comb.index]!;
        comb.store = delayed * (1 - damping) + comb.store * damping;
        comb.buffer[comb.index] = sample + comb.store * feedback;
        comb.index = (comb.index + 1) % comb.buffer.length;
        wet += delayed;
      }
      for (const allpass of allpasses) {
        const delayed = allpass.buffer[allpass.index]!;
        allpass.buffer[allpass.index] = wet + delayed * 0.5;
        allpass.index = (allpass.index + 1) % allpass.buffer.length;
        wet = delayed - wet;
      }
      out[index] = wet;
    }
    return out;
  };
  return { left: channel(0), right: channel(23) };
}

function pingPong(input: Stereo, delaySeconds: number, feedback: number): Stereo {
  const delay = Math.round(delaySeconds * RATE);
  const left = new Float32Array(input.left.length);
  const right = new Float32Array(input.left.length);
  let toneLeft = 0;
  let toneRight = 0;
  for (let index = 0; index < left.length; index++) {
    const fromRight = index >= delay ? right[index - delay]! : 0;
    const fromLeft = index >= delay ? left[index - delay]! : 0;
    toneLeft += (fromRight - toneLeft) * 0.35;
    toneRight += (fromLeft - toneRight) * 0.35;
    left[index] = (index >= delay ? input.left[index - delay]! : 0) + toneLeft * feedback;
    right[index] = toneRight * feedback;
  }
  return { left, right };
}

function pump(input: Stereo, kicks: number[], depth: number, release: number): Stereo {
  const gain = new Float32Array(input.left.length).fill(1);
  const attack = Math.round(0.004 * RATE);
  kicks.forEach((at) => {
    const start = Math.round(at * RATE);
    const length = Math.round(release * RATE);
    for (let index = -attack; index < length; index++) {
      const position = start + index;
      if (position < 0 || position >= gain.length) continue;
      const recovery = index < 0 ? -index / attack : (index / length) ** 0.7;
      gain[position] = Math.min(gain[position]!, 1 - depth * (1 - recovery));
    }
  });
  return { left: input.left.map((sample, index) => sample * gain[index]!), right: input.right.map((sample, index) => sample * gain[index]!) };
}

/** Silences a mix between two seconds, fading into it over a few milliseconds so the cut doesn't click. */
export function silence(mix: Stereo, from: number, to: number) {
  const fade = Math.round(0.012 * RATE);
  const start = Math.round(from * RATE);
  const end = Math.min(mix.left.length, Math.round(to * RATE));
  for (let index = Math.max(0, start - fade); index < end; index++) {
    const gain = index < start ? (start - index) / fade : 0;
    mix.left[index]! *= gain;
    mix.right[index]! *= gain;
  }
}

export function fadeOut(mix: Stereo, seconds: number) {
  const fade = Math.round(seconds * RATE);
  for (let index = mix.left.length - fade; index < mix.left.length; index++) {
    const gain = (mix.left.length - index) / fade;
    mix.left[index]! *= gain;
    mix.right[index]! *= gain;
  }
}

/** Writes the mix as 16-bit stereo, its peak just under full scale with a soft clip, then turned to `level`. */
export function writeWav(path: string, { left, right }: Stereo, level = 1) {
  const peak = [left, right].reduce((loudest, channel) => channel.reduce((most, sample) => Math.max(most, Math.abs(sample)), loudest), 0);
  const gain = 0.89 / peak;
  const data = Buffer.alloc(left.length * 4);
  left.forEach((sample, index) => {
    data.writeInt16LE(Math.round(Math.tanh(sample * gain * 1.1) * 32000 * level), index * 4);
    data.writeInt16LE(Math.round(Math.tanh(right[index]! * gain * 1.1) * 32000 * level), index * 4 + 2);
  });
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, Buffer.concat([header, data]));
}

/** Whole beats between two moments, near a tempo: the beat stretches a little so both moments fall on one. */
export function grid(from: number, to: number, bpm: number, wholeBars = false) {
  const unit = wholeBars ? 4 : 1;
  const beats = Math.max(unit, Math.round(((to - from) * bpm) / 60 / unit) * unit);
  const beat = (to - from) / beats;
  return { from, to, beats, beat, bar: beat * 4, bars: Math.floor(beats / 4), at: (beatIndex: number) => from + beatIndex * beat, nearestBeat: (time: number) => from + Math.round((time - from) / beat) * beat };
}
export type Grid = ReturnType<typeof grid>;

export function kick({ tone = 48, punch = 150, decay = 7, click = 0.35, seconds = 0.5 } = {}) {
  let phase = 0;
  return render(seconds, (t) => {
    phase += (2 * Math.PI * (tone + punch * Math.exp(-t * 38))) / RATE;
    return Math.tanh(1.6 * (Math.sin(phase) * Math.exp(-t * decay) + click * noise() * Math.exp(-t * 400)));
  });
}

export function snare({ tone = 190, decay = 16, body = 0.55, seconds = 0.4 } = {}) {
  const skin = render(seconds, (t) => body * (Math.sin(2 * Math.PI * tone * t) + 0.5 * Math.sin(2 * Math.PI * tone * 1.62 * t)) * Math.exp(-t * 28));
  const wires = highpass(bandpass(render(seconds, (t) => noise() * Math.exp(-t * decay)), 4200, 0.6), 1500);
  return sum(skin, shape(wires, () => 1.6));
}

export function clap() {
  const raw = render(0.3, (t) => noise() * ([0, 0.011, 0.022].some((burst) => t >= burst && t < burst + 0.008) || t >= 0.03 ? Math.exp(-Math.max(0, t - 0.03) * 22) : 0));
  return highpass(bandpass(raw, 1500, 0.8), 600);
}

const METALLIC = [205.3, 304.4, 369.6, 522.7, 540, 800];
function metallic(seconds: number, pitch = 1.6) {
  const phases = METALLIC.map(() => Math.abs(noise()));
  return render(seconds, (t) => METALLIC.reduce((total, frequency, index) => total + (((frequency * pitch * t + phases[index]!) % 1) < 0.5 ? 1 : -1), 0) / METALLIC.length);
}

export function hat(decay = 70) {
  const seconds = Math.min(1.2, 6 / decay);
  return highpass(shape(sum(metallic(seconds), render(seconds, () => noise() * 0.6)), (t) => Math.exp(-t * decay)), 7500, 0.9);
}

export function crash(seconds = 2.6) {
  const raw = sum(shape(metallic(seconds, 2.3), () => 0.5), render(seconds, () => noise()));
  return highpass(shape(raw, (t) => Math.min(1, t / 0.002) * Math.exp(-t * 1.5)), 3800, 0.7);
}

/** A cymbal swelling up into a hit: a crash played backwards. */
export function swell(seconds: number) {
  return reversed(highpass(shape(sum(shape(metallic(seconds, 2.3), () => 0.4), render(seconds, () => noise())), (t) => Math.exp(-t * (3.2 / seconds))), 3000, 0.7));
}

/** A sub drop with a burst of air, for the big hits. */
export function boom(seconds = 3.2) {
  let phase = 0;
  const sub = render(seconds, (t) => {
    phase += (2 * Math.PI * (30 + 42 * Math.exp(-t * 5))) / RATE;
    return Math.sin(phase) * Math.exp(-t * 1.3);
  });
  const air = lowpass(render(Math.min(seconds, 1.6), (t) => noise() * Math.exp(-t * 3.5)), 1800);
  return sum(sub, shape(air, () => 0.5));
}

/** Noise swelling up through a rising filter, into a hit. */
export function riser(seconds: number) {
  return lowpass(render(seconds, (t) => noise() * (t / seconds) ** 2.2), (t) => 250 * 30 ** (t / seconds));
}

const spreadOf = (voice: number, voices: number) => (voices === 1 ? 0 : (voice / (voices - 1)) * 2 - 1);

/** Detuned saws spread across the stereo field, through a filter: the big electronic chord. */
export function supersaw(notes: number[], seconds: number, { voices = 7, detune = 24, cutoff = 5000 as Curve, q = 0.8, attack = 0.01, release = 0.25, width = 0.9, glide = (() => 1) as (t: number) => number } = {}): Stereo {
  const left = new Float32Array(samples(seconds));
  const right = new Float32Array(samples(seconds));
  notes.forEach((note) =>
    Array.from({ length: voices }, (_, voice) => {
      const spread = spreadOf(voice, voices);
      const frequency = midi(note) * 2 ** ((spread * detune) / 1200);
      const oscillator = saw((t) => frequency * glide(t), seconds, Math.abs(noise()));
      const [leftGain, rightGain] = panGains(spread * width);
      oscillator.forEach((sample, index) => {
        left[index]! += sample * leftGain;
        right[index]! += sample * rightGain;
      });
    }),
  );
  const level = 1 / Math.sqrt(notes.length * voices);
  const finish = (channel: Float32Array) => shape(lowpass(channel, cutoff, q), (t) => level * envelope(t, seconds, attack, release));
  return { left: finish(left), right: finish(right) };
}

/** A soft bell-like pluck. */
export function pluck(note: number, seconds = 1.6, brightness = 1.2) {
  const frequency = midi(note);
  return render(seconds, (t) => Math.sin(2 * Math.PI * frequency * t + brightness * Math.exp(-t * 9) * Math.sin(2 * Math.PI * frequency * 2 * t)) * Math.exp(-t * 3.2) * Math.min(1, t / 0.004));
}

/** A saw pluck through a closing resonant filter, the electronic arpeggio's voice. */
export function sawPluck(note: number, seconds = 0.4, { open = 3200, q = 1.6, decay = 14 } = {}) {
  const raw = sum(saw(midi(note), seconds, Math.abs(noise())), saw(midi(note) * 1.006, seconds, Math.abs(noise())));
  return shape(lowpass(raw, (t) => 250 + open * Math.exp(-t * decay), q), (t) => 0.5 * envelope(t, seconds, 0.002, 0.05) * Math.exp(-t * 4));
}

export function subBass(note: number, seconds: number, attack = 0.005, release = 0.05) {
  const frequency = midi(note);
  return lowpass(render(seconds, (t) => (Math.sin(2 * Math.PI * frequency * t) + 0.25 * Math.sin(4 * Math.PI * frequency * t)) * envelope(t, seconds, attack, release)), 320);
}

export function synthBass(note: number, seconds: number, { open = 1100, q = 1.3, decay = 12 } = {}) {
  const raw = saw(midi(note), seconds, 0);
  const growl = shape(lowpass(raw, (t) => 120 + open * Math.exp(-t * decay), q), () => 0.6);
  return shape(sum(growl, subBass(note, seconds)), (t) => envelope(t, seconds, 0.003, 0.03) * 0.6);
}

export type Note = { at: number; note: number; length: number };

/** A monophonic lead playing a phrase, gliding between notes, with a vibrato that grows on held notes. */
export function lead(phrase: Note[], { glide = 0.03, cutoff = 2600, square = 0.4, vibrato = 0.006 } = {}) {
  const seconds = Math.max(...phrase.map(({ at, length }) => at + length)) + 0.3;
  const noteAt = (t: number) => phrase.findLast(({ at }) => at <= t) ?? phrase[0]!;
  let previous = phrase[0]!.note;
  let current = previous;
  const pitch = new Float32Array(samples(seconds));
  const amp = new Float32Array(samples(seconds));
  const sinceStart = new Float32Array(samples(seconds));
  let last: Note | undefined;
  for (let index = 0; index < pitch.length; index++) {
    const t = index / RATE;
    const note = noteAt(t);
    if (note !== last) {
      previous = current;
      last = note;
    }
    const since = t - note.at;
    current = note.note + (previous - note.note) * Math.exp(-since / glide);
    const held = Math.max(0, since - 0.18);
    pitch[index] = midi(current) * (1 + vibrato * Math.min(1, held / 0.3) * Math.sin(2 * Math.PI * 5.6 * t));
    amp[index] = envelope(since, note.length, 0.008, 0.06);
    sinceStart[index] = since;
  }
  const tone = sum(saw((t) => pitch[Math.floor(t * RATE)]!, seconds), shape(pulse((t) => pitch[Math.floor(t * RATE)]! * 0.5, seconds), () => square));
  const filtered = lowpass(tone, (t) => 500 + cutoff * (0.5 + 0.5 * Math.exp(-sinceStart[Math.min(sinceStart.length - 1, Math.floor(t * RATE))]! * 5)), 1.1);
  return filtered.map((sample, index) => sample * amp[index]! * 0.4);
}

/** Saws climbing in pitch and brightness into a hit, ending exactly on it. */
export function tonalRiser(notes: number[], seconds: number, semitones = 12) {
  const climb = (t: number) => 2 ** ((semitones * (t / seconds) ** 1.6) / 12);
  const raw = supersaw(notes, seconds, { voices: 5, detune: 30, cutoff: (t) => 300 * 25 ** (t / seconds), q: 1.2, attack: 0.05, release: 0.006, glide: climb });
  return stereoMap(raw, (channel) => shape(channel, (t) => (t / seconds) ** 2));
}

/** A drum roll speeding up from eighths to sixteenths to thirty-seconds, and growing louder, into a beat. */
export function roll(buses: Buses, g: Grid, fromBeat: number, toBeat: number, { from = 0.06, to = 0.3, sound = snare({ decay: 26 }), verb = 0.15 } = {}) {
  const span = toBeat - fromBeat;
  for (let beat = fromBeat, hit = 0; beat < toBeat - 1e-6; hit++) {
    const progress = (beat - fromBeat) / span;
    buses.add(g.at(beat), sound, from + (to - from) * progress ** 1.5, { pan: hit % 2 ? 0.12 : -0.12, verb });
    beat += progress < 0.5 ? 0.5 : progress < 0.75 ? 0.25 : 0.125;
  }
}

/** A phrase written as [sixteenth, note, sixteenths long], placed on a grid from a beat. */
export function phrase(g: Grid, fromBeat: number, steps: [number, number, number][], transpose = 0): Note[] {
  return steps.map(([step, note, length]) => ({ at: g.at(fromBeat + step / 4) - g.at(fromBeat), note: note + transpose, length: (length * g.beat) / 4 }));
}

export const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index);

/**
 * A look-ahead peak limiter: brings every peak down to `peakOverRms` decibels above the mix's loudness (its RMS over the
 * blocks that aren't near silence), easing in before each peak and back out over `release` seconds.
 */
export function limit(mix: Stereo, peakOverRms = 12, release = 0.25) {
  const length = mix.left.length;
  const block = Math.round(0.4 * RATE);
  const blocks = range(0, Math.floor(length / block)).map((index) => {
    let total = 0;
    for (let at = index * block; at < (index + 1) * block; at++) total += (mix.left[at]! ** 2 + mix.right[at]! ** 2) / 2;
    return total / block;
  });
  const loudest = Math.max(...blocks);
  const active = blocks.filter((power) => power > loudest * 1e-3);
  const rms = Math.sqrt(active.reduce((total, power) => total + power, 0) / active.length);
  const ceiling = rms * 10 ** (peakOverRms / 20);
  const needed = Float32Array.from({ length }, (_, index) => Math.min(1, ceiling / Math.max(1e-9, Math.abs(mix.left[index]!), Math.abs(mix.right[index]!))));
  const ahead = Math.round(0.005 * RATE);
  const lowest = new Float32Array(length);
  const window: number[] = [];
  for (let index = 0; index < length + ahead; index++) {
    if (index < length) {
      while (window.length && needed[window.at(-1)!]! >= needed[index]!) window.pop();
      window.push(index);
    }
    const centre = index - ahead;
    if (centre < 0) continue;
    while (window[0]! < centre - ahead) window.shift();
    lowest[centre] = needed[window[0]!]!;
  }
  const releaseStep = 1 - Math.exp(-1 / (release * RATE));
  const attackStep = 1 - Math.exp(-1 / (0.002 * RATE));
  for (let index = 1; index < length; index++) lowest[index] = Math.min(lowest[index]!, lowest[index - 1]! + (1 - lowest[index - 1]!) * releaseStep);
  for (let index = length - 2; index >= 0; index--) lowest[index] = Math.min(lowest[index]!, lowest[index + 1]! + (1 - lowest[index + 1]!) * attackStep);
  let reduced = 0;
  for (let index = 0; index < length; index++) {
    mix.left[index]! *= lowest[index]!;
    mix.right[index]! *= lowest[index]!;
    reduced = Math.min(reduced, 20 * Math.log10(lowest[index]!));
  }
  console.log(`limiter: ceiling ${peakOverRms} dB over RMS, at most ${(-reduced).toFixed(1)} dB of reduction`);
  return ceiling;
}

export const peakOf = ({ left, right }: Stereo) => Math.max(left.reduce((most, sample) => Math.max(most, Math.abs(sample)), 0), right.reduce((most, sample) => Math.max(most, Math.abs(sample)), 0));

/**
 * Makes room for the narrator: turns the band where words are understood (1–4 kHz) down while a line is spoken, easing
 * in and out like the ducking. It dips like a bell: by about `depth` decibels at the band's edges and a little more in
 * its middle, around 2 kHz, fading out an octave or so beyond them. Elsewhere the bands add back up exactly.
 */
export function carve(mix: Stereo, spans: { from: number; to: number }[], depth = 6, { lowEdge = 1000, highEdge = 4000, ramp = 0.25 } = {}) {
  const floor = 10 ** (-depth / 20);
  const gainAt = (t: number) => spans.reduce((gain, { from, to }) => {
    if (t < from - ramp || t > to + ramp) return gain;
    const into = t < from ? (from - t) / ramp : t > to ? (t - to) / ramp : 0;
    return Math.min(gain, floor + (1 - floor) * into);
  }, 1);
  const split = (channel: Float32Array) => {
    const low = lowpass(channel, lowEdge, 0.5);
    const high = highpass(channel, highEdge, 0.5);
    const gains = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 480) gains.fill(gainAt(index / RATE), index, index + 480);
    return channel.map((sample, index) => {
      const middle = sample - low[index]! - high[index]!;
      return low[index]! + high[index]! + middle * gains[index]!;
    });
  };
  const left = split(mix.left);
  const right = split(mix.right);
  mix.left.set(left);
  mix.right.set(right);
}

/** Takes out what's below hearing (under about 28 Hz), which would otherwise set the peaks the limiter works from. */
export function subsonic(mix: Stereo, cutoff = 28) {
  mix.left.set(highpass(highpass(mix.left, cutoff), cutoff));
  mix.right.set(highpass(highpass(mix.right, cutoff), cutoff));
  return mix;
}
