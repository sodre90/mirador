import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CROSSFADE_FRAMES, FRAME } from "../src/brand.ts";
import { spokenSpans } from "../src/mix.ts";
import { STORYBOARD } from "../src/storyboard.ts";
import type { ClipInfo, NarrationLine } from "../src/timeline.ts";
import { placeScenes } from "../src/timeline.ts";
import {
  boom, Buses, carve, clap, crash, fadeOut, grid, hat, kick, lead, limit, Mix, phrase, pluck, range, riser, roll, sawPluck, snare, subBass, subsonic, supersaw, swell, synthBass, tonalRiser, writeWav, type Grid,
} from "./synth.ts";

/**
 * The trailer's score, synthesised (synth.ts) so there is no track to licence or credit: driving electronic music in D
 * minor near 144 BPM. Pumping chords and a climbing arpeggio swell under the opening picture into a hit on the cut to
 * the app. Then a half-time groove with a
 * rolling bass runs under the first features and builds into a four-on-the-floor drop on the review, where a synth hook
 * plays in the gaps between lines, and goes on into the montage with the whole hook doubled an octave up. The plugins
 * bring a lighter half-time breakdown, which builds into the voice scene, where the music steps up to E minor and leaves
 * room for the conversation. Its last chord rings over the backdrop and resolves to E major on the end card's hit.
 * Each stretch's tempo bends a little so the scene changes land on beats; it is timed by the storyboard, so the hits land
 * on the scene changes however long the scenes run. While the narrator speaks, the band where words are heard is turned
 * down, on top of the ducking in src/mix.ts.
 * Run with bun after encode and narrate: bun audio/compose.ts
 */
const video = join(import.meta.dirname, "..");
const output = join(video, "public", "music", "score.wav");
const TEMPO = 144;
/** The score was chosen at this level, a little under its own peak, where it is as loud as the score before it. */
const LEVEL = 10 ** (-1.07 / 20);

/** The storyboard's moments in seconds of the trailer, and when the narrator speaks. */
function timeline() {
  const clipNames = [...new Set(STORYBOARD.flatMap((scene) => (scene.kind === "clip" ? [scene.clip] : [])))];
  const clips = Object.fromEntries(clipNames.map((name) => [name, JSON.parse(readFileSync(join(video, "public", "clips", `${name}.json`), "utf8")) as ClipInfo]));
  const { lines } = JSON.parse(readFileSync(join(video, "public", "narration", "manifest.json"), "utf8")) as { lines: Record<string, NarrationLine> };
  const placed = placeScenes(STORYBOARD, clips, lines, FRAME.fps, CROSSFADE_FRAMES);
  const last = placed.at(-1)!;
  const starts = Object.fromEntries(placed.map(({ scene, from }) => [scene.id, from / FRAME.fps]));
  const startOf = (id: string) => {
    const start = starts[id];
    if (start === undefined) throw new Error(`The score expects a scene "${id}" in the storyboard`);
    return start;
  };
  return {
    seconds: (last.from + last.frames) / FRAME.fps,
    coldOpen: startOf("coldShow"),
    picture: startOf("hook"),
    show: startOf("show"),
    ask: startOf("ask"),
    review: startOf("review"),
    plugins: startOf("plugins"),
    media: startOf("media"),
    delegate: startOf("delegate"),
    jobs: startOf("jobs"),
    voice: startOf("voice"),
    montage: startOf("edit"),
    terminals: startOf("terminals"),
    groups: startOf("groups"),
    overview: startOf("overview"),
    lastChord: startOf("backdrop"),
    ending: startOf("end"),
    spoken: spokenSpans(placed, lines, FRAME.fps).map(({ from, to }) => ({ from: from / FRAME.fps, to: to / FRAME.fps })),
  };
}
type Moments = ReturnType<typeof timeline>;

const DM = { chord: [50, 57, 62, 65, 69], bass: 38, arp: [62, 65, 69, 74] };
const BB = { chord: [50, 53, 58, 62, 65], bass: 34, arp: [58, 62, 65, 70] };
const F = { chord: [48, 53, 57, 60, 65], bass: 41, arp: [60, 65, 69, 72] };
const C = { chord: [48, 52, 55, 60, 64], bass: 36, arp: [60, 64, 67, 72] };
type Chord = typeof DM;
const up = ({ chord, bass, arp }: Chord, semitones: number): Chord => ({ chord: chord.map((note) => note + semitones), bass: bass + semitones, arp: arp.map((note) => note + semitones) });
const PROGRESSION = [DM, BB, F, C];

/** The synth hook, four bars of [sixteenth, note, sixteenths long]. */
const HOOK: [number, number, number][] = [
  [0, 74, 2], [2, 77, 2], [4, 81, 3], [7, 79, 1], [8, 77, 2], [10, 76, 2], [12, 74, 4],
  [16, 74, 2], [18, 77, 2], [20, 82, 3], [23, 81, 1], [24, 79, 2], [26, 77, 2], [28, 81, 4],
  [32, 81, 2], [34, 79, 2], [36, 77, 3], [39, 76, 1], [40, 77, 2], [42, 79, 2], [44, 81, 4],
  [48, 79, 3], [51, 76, 1], [52, 72, 2], [54, 76, 2], [56, 79, 8],
];
const hookBars = (fromBar: number, toBar: number) => HOOK.filter(([step]) => step >= fromBar * 16 && step < toBar * 16).map(([step, note, length]): [number, number, number] => [step - fromBar * 16, note, length]);

const drumKit = () => ({ kick: kick(), bigKick: kick({ punch: 190, decay: 5, seconds: 0.7 }), clap: clap(), snare: snare(), closedHat: hat(80), softHat: hat(120), openHat: hat(14) });

/** The score, stretch by stretch. */
class Score {
  private readonly drums = drumKit();
  private readonly main: Buses;

  constructor(private readonly at: Moments) {
    this.main = new Buses(at.seconds);
  }

  render() {
    const { at } = this;
    this.coldOpen();
    this.picture();
    const firstFeatureBeat = this.features();
    this.hit(firstFeatureBeat);
    this.drop();
    this.montage();
    this.breakdown();
    this.closer();
    this.ending();
    const mix = new Mix(at.seconds);
    mix.addStereo(0, this.main.bounce({ depth: 0.65, release: 0.24, delaySeconds: (0.75 * 60) / TEMPO, feedback: 0.35 }), 1);
    subsonic(mix);
    limit(mix, 12);
    carve(mix, at.spoken);
    fadeOut(mix, 1.8);
    return mix;
  }

  /** The cold open: a hit on every cut, the beat driving between them, and a riser into the hook's slam. */
  private coldOpen() {
    const { at, main, drums } = this;
    const g = grid(at.coldOpen, at.picture, TEMPO, true);
    const chords = [DM, BB, F, C, DM, up(C, 2)];
    range(0, g.beats / 2).forEach((cut) => {
      const hit = g.at(cut * 2);
      main.add(hit, drums.bigKick, 0.8);
      main.add(hit, crash(), cut === 0 ? 0.45 : 0.22, { verb: 0.25 });
      main.add(hit, supersaw(chords[cut % chords.length]!.chord, 1.6 * g.beat, { cutoff: (t) => 900 + 6000 * Math.exp(-t * 4), attack: 0.003, release: 0.12 }), 0.42, { pump: true, verb: 0.3 });
      main.add(hit, subBass(chords[cut % chords.length]!.bass, 2 * g.beat - 0.02), 0.35, { pump: true });
      main.add(g.at(cut * 2 + 1), drums.kick, 0.55);
      main.add(g.at(cut * 2 + 1), drums.clap, 0.3, { verb: 0.2 });
    });
    range(0, g.beats * 2).forEach((step) => main.add(g.at(step / 2), step % 2 ? drums.openHat : drums.closedHat, step % 2 ? 0.04 : 0.05, { pan: step % 2 ? 0.25 : -0.25 }));
    main.pumpAt(...range(0, g.beats).map(g.at));
    roll(main, g, g.beats - 2, g.beats, { from: 0.1, to: 0.35 });
    main.add(g.at(g.beats - 4), riser(4 * g.beat), 0.3);
    main.add(at.picture, drums.bigKick, 0.9);
    main.add(at.picture, boom(), 1);
    main.add(at.picture, crash(), 0.4, { verb: 0.3 });
  }

  private picture() {
    const { at, main, drums } = this;
    const g = grid(at.show - (8 * 60) / TEMPO, at.show, TEMPO);
    main.add(at.picture, supersaw(BB.chord, g.at(4) - at.picture + 0.1, { cutoff: (t) => 400 * 5 ** (t / 2), attack: 1, release: 0.1 }), 0.38, { pump: true, verb: 0.35 });
    main.add(g.at(4), supersaw(C.chord, 4 * g.beat + 0.05, { cutoff: (t) => 2000 * 3 ** (t / (4 * g.beat)), attack: 0.02, release: 0.04 }), 0.4, { pump: true, verb: 0.35 });
    main.pumpAt(...range(0, 8).map(g.at));
    range(0, 32).forEach((step) => {
      const chord = step < 16 ? BB : C;
      const note = chord.arp[step % 4]! + 12 * Math.floor((step % 16) / 8);
      main.add(g.at(step / 4), sawPluck(note, 0.3, { open: 1500 + 2500 * (step / 32) }), 0.07 + 0.07 * (step / 32), { pan: step % 2 ? 0.4 : -0.4, delay: 0.3 });
    });
    range(4, 8).forEach((beat) => main.add(g.at(beat), drums.kick, 0.5));
    roll(main, g, 6, 8, { from: 0.08, to: 0.3 });
    main.add(g.at(4), tonalRiser([62, 69], 4 * g.beat), 0.25, { verb: 0.2 });
    main.add(at.picture, riser(at.show - at.picture), 0.3);
  }

  /** The hit on the cut from the opening picture to the app, with a snare pickup into it. */
  private hit(firstBeat: Grid) {
    const { at, main, drums } = this;
    main.add(at.show, drums.bigKick, 0.9);
    main.add(at.show, boom(), 1);
    main.add(at.show, crash(), 0.4, { verb: 0.3 });
    main.add(at.show, supersaw([38, ...DM.chord, 74], 2.6, { cutoff: (t) => 700 + 7000 * Math.exp(-t * 2.2), attack: 0.004, release: 1.8 }), 0.5, { verb: 0.5 });
    range(0, 4).forEach((sixteenth) => main.add(firstBeat.at(-1 + sixteenth / 4), drums.snare, 0.08 + 0.05 * sixteenth, { verb: 0.15 }));
  }

  /** Bars of the groove: the chord pumping, the sub and rolling bass, and the arpeggio when it's busy. */
  private harmony(g: Grid, bar: number, chord: Chord, { bars = 1, cutoff = 2600 as number | ((t: number) => number), gain = 0.3, rolling = true, arp = false, arpGain = 0.06, ringsOn = 0 } = {}) {
    const { main } = this;
    main.add(g.at(bar * 4), supersaw(chord.chord, bars * g.bar + 0.04 + ringsOn, { cutoff, attack: 0.015, release: ringsOn ? ringsOn * 0.8 : 0.05 }), gain, { pump: true, verb: 0.15 });
    range(0, bars).forEach((offset) => {
      const barStart = bar + offset;
      main.add(g.at(barStart * 4), subBass(chord.bass, g.bar - 0.02), 0.32, { pump: true });
      if (rolling) range(0, 16).filter((step) => step % 4 !== 0).forEach((step) => main.add(g.at(barStart * 4 + step / 4), synthBass(chord.bass + 12 + (step % 4 === 2 ? 12 : 0), g.beat / 4.4), 0.22, { pump: true }));
      if (arp) range(0, 16).forEach((step) => main.add(g.at(barStart * 4 + step / 4), sawPluck(chord.arp[(step * 3) % 4]! + (step >= 8 ? 12 : 0), 0.25), arpGain, { pan: step % 2 ? 0.45 : -0.45, delay: 0.3 }));
    });
  }

  /** A cymbal on the beat nearest a dissolve, swelling into it. */
  private accent(g: Grid, time: number) {
    const onBeat = g.nearestBeat(time);
    this.main.add(onBeat - 2 * g.beat, swell(2 * g.beat), 0.18);
    this.main.add(onBeat, crash(), 0.3, { verb: 0.2 });
  }

  private halfTime(g: Grid, bar: number, busy: boolean) {
    const { main, drums } = this;
    const beatAt = (offset: number) => g.at(bar * 4 + offset);
    [0, 1.5, ...(busy ? [2.75] : [])].forEach((offset) => main.add(beatAt(offset), drums.kick, 0.55));
    main.add(beatAt(2), drums.snare, 0.32, { verb: 0.2 });
    if (busy) main.add(beatAt(2), drums.clap, 0.18, { verb: 0.2 });
    range(0, busy ? 16 : 8).forEach((step) => main.add(beatAt(step / (busy ? 4 : 2)), step % 2 ? drums.closedHat : drums.softHat, busy ? (step % 2 ? 0.05 : 0.035) : 0.035, { pan: step % 2 ? 0.3 : -0.3 }));
    if (busy) main.add(beatAt(3.5), drums.openHat, 0.05, { pan: 0.2 });
    main.pumpAt(...range(0, 4).map(beatAt));
  }

  private fourOnTheFloor(g: Grid, bar: number) {
    const { main, drums } = this;
    const beatAt = (offset: number) => g.at(bar * 4 + offset);
    range(0, 4).forEach((offset) => {
      main.add(beatAt(offset), drums.kick, 0.6);
      main.add(beatAt(offset + 0.5), drums.openHat, 0.05, { pan: 0.2 });
    });
    [1, 3].forEach((offset) => main.add(beatAt(offset), drums.clap, 0.3, { pan: offset === 1 ? -0.1 : 0.1, verb: 0.15 }));
    range(0, 16).forEach((step) => main.add(beatAt(step / 4), step % 4 === 2 ? drums.closedHat : drums.softHat, step % 4 === 2 ? 0.05 : 0.03, { pan: step % 2 ? 0.3 : -0.3 }));
    main.pumpAt(...range(0, 4).map(beatAt));
  }

  private playHook(g: Grid, bar: number, fromHookBar: number, toHookBar: number, transpose = 0, octave = false) {
    const notes = phrase(g, bar * 4, hookBars(fromHookBar, toHookBar), transpose);
    this.main.add(g.at(bar * 4), lead(notes), 0.2, { delay: 0.35, verb: 0.25 });
    if (octave) this.main.add(g.at(bar * 4), lead(notes.map((note) => ({ ...note, note: note.note + 12 })), { square: 0.1, cutoff: 1800 }), 0.09, { delay: 0.35, verb: 0.25, pan: 0.2 });
  }

  /** From the first feature to the review: a light half-time groove, busier from its ninth bar, then a build. */
  private features() {
    const { at, main, drums } = this;
    const g = grid(at.show, at.review, TEMPO, true);
    const buildFrom = g.bars - 2;
    range(0, g.bars).forEach((bar) => {
      const chord = PROGRESSION[Math.floor(bar / 2) % 4]!;
      const building = bar >= buildFrom;
      if (bar % 2 === 0) {
        const bars = Math.min(2, g.bars - bar);
        const opening = bar >= 8;
        this.harmony(g, bar, chord, { bars, cutoff: building ? (t) => 1800 * 4.5 ** (t / (bars * g.bar)) : opening ? 1800 : 950, gain: building ? 0.28 : opening ? 0.24 : 0.2, rolling: opening, arp: opening, arpGain: building ? 0.08 : 0.055 });
      }
      if (!building) return this.halfTime(g, bar, bar >= 8);
      const beats = bar === g.bars - 1 ? [0, 1, 2] : [0, 2];
      beats.forEach((offset) => main.add(g.at(bar * 4 + offset), drums.kick, 0.55));
      main.pumpAt(...range(0, 4).map((offset) => g.at(bar * 4 + offset)));
    });
    roll(main, g, buildFrom * 4, g.beats, { from: 0.06, to: 0.34 });
    main.add(g.at(buildFrom * 4), tonalRiser([62, 69, 74], 2 * g.bar), 0.26, { verb: 0.2 });
    main.add(g.at(buildFrom * 4), riser(2 * g.bar), 0.25);
    this.accent(g, at.ask);
    return g;
  }

  /** From the review to the montage: four on the floor, with the hook in the gaps between lines. */
  private drop() {
    const { at, main } = this;
    const g = grid(at.review, at.montage, TEMPO, true);
    main.add(at.review, crash(), 0.5, { verb: 0.3 });
    range(0, g.bars).forEach((bar) => {
      this.harmony(g, bar, PROGRESSION[bar % 4]!, { cutoff: 5000, gain: 0.32, arp: true });
      this.fourOnTheFloor(g, bar);
    });
    this.playHook(g, 0, 0, 2);
    this.playHook(g, 9, 0, 3);
    main.add(at.montage - 2 * g.beat, swell(2 * g.beat), 0.2);
  }

  /** From the plugins to the voice scene: the groove falls back to half time and a darker chord, then builds again. */
  private breakdown() {
    const { at, main, drums } = this;
    const g = grid(at.plugins, at.voice, TEMPO, true);
    const buildFrom = g.bars - 2;
    main.add(at.plugins, crash(), 0.4, { verb: 0.35 });
    range(0, g.bars).forEach((bar) => {
      const chord = PROGRESSION[Math.floor(bar / 2) % 4]!;
      const building = bar >= buildFrom;
      if (bar % 2 === 0) {
        const bars = Math.min(2, g.bars - bar);
        this.harmony(g, bar, chord, { bars, cutoff: building ? (t) => 1400 * 5 ** (t / (bars * g.bar)) : 1300, gain: building ? 0.27 : 0.22, rolling: bar >= 4, arp: bar >= 4, arpGain: 0.05 });
      }
      if (!building) return this.halfTime(g, bar, bar >= 4);
      const beats = bar === g.bars - 1 ? [0, 1, 2] : [0, 2];
      beats.forEach((offset) => main.add(g.at(bar * 4 + offset), drums.kick, 0.55));
      main.pumpAt(...range(0, 4).map((offset) => g.at(bar * 4 + offset)));
    });
    roll(main, g, buildFrom * 4, g.beats, { from: 0.06, to: 0.32 });
    main.add(g.at(buildFrom * 4), tonalRiser([62, 69, 74], 2 * g.bar), 0.24, { verb: 0.2 });
    main.add(g.at(buildFrom * 4), riser(2 * g.bar), 0.24);
    [at.media, at.delegate, at.jobs].forEach((time) => this.accent(g, time));
  }

  /** From the montage to the plugins, still four on the floor, with the whole hook doubled an octave up. */
  private montage() {
    const { at, main, drums } = this;
    const g = grid(at.montage, at.plugins, TEMPO, true);
    main.add(at.montage, crash(), 0.5, { verb: 0.3 });
    range(0, g.bars).forEach((bar) => {
      this.harmony(g, bar, PROGRESSION[bar % 4]!, { cutoff: bar === 7 ? (t) => 1500 * 4 ** (t / g.bar) : 6500, gain: 0.33, arp: true, arpGain: 0.07 });
      this.fourOnTheFloor(g, bar);
      if (bar >= 4) range(0, 4).forEach((offset) => main.add(g.at(bar * 4 + offset + 0.5), drums.snare, 0.05, { verb: 0.1 }));
    });
    roll(main, g, 7 * 4, 8 * 4, { from: 0.04, to: 0.2 });
    this.playHook(g, 8, 0, 4, 0, true);
    [at.terminals, at.groups, at.overview].forEach((time) => this.accent(g, time));
    main.add(at.plugins - 2 * g.beat, swell(2 * g.beat), 0.2);
  }

  /** From the voice scene to the backdrop, a step higher and in half time, quiet under the conversation; the last chord rings on. */
  private closer() {
    const { at, main } = this;
    const g = grid(at.voice, at.lastChord, TEMPO, true);
    const lifted = PROGRESSION.map((chord) => up(chord, 2));
    main.add(at.voice, crash(), 0.45, { verb: 0.35 });
    range(0, g.bars).forEach((bar) => {
      const last = bar === g.bars - 1;
      this.harmony(g, bar, lifted[bar % 4]!, { cutoff: 2200, gain: 0.26, arp: true, arpGain: 0.05, ringsOn: last ? at.ending - at.lastChord + 0.9 : 0 });
      this.halfTime(g, bar, false);
    });
  }

  private ending() {
    const { at, main, drums } = this;
    const eMajor = [40, 52, 59, 64, 68, 71, 78];
    main.add(at.ending, drums.bigKick, 0.9);
    main.add(at.ending, boom(), 1.2);
    main.add(at.ending, crash(3), 0.45, { verb: 0.4 });
    main.add(at.ending, supersaw(eMajor, at.seconds - at.ending, { cutoff: (t) => 800 + 5000 * Math.exp(-t * 2.5), attack: 0.004, release: 3 }), 0.48, { verb: 0.5 });
    main.add(at.ending, subBass(28, 3, 0.005, 2.5), 0.4);
    [76, 80, 83, 88, 90].forEach((note, index) => main.add(at.ending + 0.9 + index * 0.2, pluck(note, 3), 0.2, { pan: index % 2 ? 0.4 : -0.4, delay: 0.4, verb: 0.3 }));
  }
}

function compose() {
  const at = timeline();
  writeWav(output, new Score(at).render(), LEVEL);
  console.log(
    `${output}: ${at.seconds.toFixed(1)} s; picture at ${at.picture.toFixed(2)} s, hit and groove from ${at.show.toFixed(2)} s, drop at ${at.review.toFixed(2)} s, montage from ${at.montage.toFixed(2)} s, breakdown at ${at.plugins.toFixed(2)} s, voice at ${at.voice.toFixed(2)} s, last chord at ${at.lastChord.toFixed(2)} s, end card at ${at.ending.toFixed(2)} s`,
  );
}

if (import.meta.main) compose();
