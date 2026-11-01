import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CROSSFADE_FRAMES, FRAME } from "../src/brand.ts";
import { spokenSpans } from "../src/mix.ts";
import { STORYBOARD } from "../src/storyboard.ts";
import type { ClipInfo, NarrationLine, WallScene } from "../src/timeline.ts";
import { placeScenes, statementBeats } from "../src/timeline.ts";
import {
  boom, Buses, carve, clap, crash, fadeOut, grid, hat, kick, lead, limit, Mix, peakOf, phrase, pluck, range, riser, roll, sawPluck, silence, snare, subBass, subsonic, supersaw, swell, synthBass, tonalRiser, writeWav, type Grid,
} from "./synth.ts";

/**
 * The trailer's score, synthesised (synth.ts) so there is no track to licence or credit: driving electronic music in D
 * minor near 144 BPM. A pumping drone and a quickening arpeggio under the wall of text build into a snare roll and stop
 * dead for the voice: in the silence, each part of the statement lands on a clap, and from its stressed part on a hit.
 * Pumping chords and a climbing arpeggio swell under the picture into a hit on the logo. Then a half-time groove with a
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
  const wall = STORYBOARD.find((scene): scene is WallScene => scene.kind === "text-wall");
  if (!wall?.goesBlackAt || wall.pictureAt === undefined || !wall.statement) throw new Error("The score expects the wall to go black, land its statement, then show its picture");
  return {
    seconds: (last.from + last.frames) / FRAME.fps,
    goesBlack: starts[wall.id]! + wall.goesBlackAt,
    picture: starts[wall.id]! + wall.pictureAt,
    landings: statementBeats(wall.statement).map((at) => starts[wall.id]! + at),
    stressed: Math.max(0, wall.statement.parts.findIndex(({ stressed }) => stressed)),
    logo: starts.logo!,
    show: starts.show!,
    point: starts.point!,
    overview: starts.overview!,
    ask: starts.ask!,
    review: starts.review!,
    plugins: starts.plugins!,
    media: starts.media!,
    delegate: starts.delegate!,
    jobs: starts.jobs!,
    voice: starts.voice!,
    montage: starts.edit!,
    terminals: starts.terminals!,
    groups: starts.groups!,
    lastChord: starts.backdrop!,
    ending: starts.end!,
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

/** The score, stretch by stretch. The wall plays on its own buses, so its echoes and reverb stop dead with it. */
class Score {
  private readonly drums = drumKit();
  private readonly intro: Buses;
  private readonly main: Buses;

  constructor(private readonly at: Moments) {
    this.intro = new Buses(at.seconds);
    this.main = new Buses(at.seconds);
  }

  render() {
    const { at } = this;
    this.wall();
    this.picture();
    const firstFeatureBeat = this.features();
    this.logo(firstFeatureBeat);
    this.drop();
    this.montage();
    this.breakdown();
    this.closer();
    this.ending();
    const mix = new Mix(at.seconds);
    const wall = this.intro.bounce({ depth: 0.5, release: 0.25, delaySeconds: (0.75 * 60) / TEMPO });
    silence(wall, at.goesBlack, at.seconds);
    mix.addStereo(0, wall, 1);
    mix.addStereo(0, this.main.bounce({ depth: 0.65, release: 0.24, delaySeconds: (0.75 * 60) / TEMPO, feedback: 0.35 }), 1);
    subsonic(mix);
    const hits = subsonic(this.statement());
    const ceiling = limit(mix, 12);
    carve(mix, at.spoken);
    silence(mix, at.goesBlack, at.picture);
    mix.addStereo(0, hits, ceiling / peakOf(hits));
    fadeOut(mix, 1.8);
    return mix;
  }

  private wall() {
    const { at, intro, drums } = this;
    const g = grid(0, at.goesBlack, TEMPO);
    const rise = (t: number) => Math.min(1, t / at.goesBlack);
    intro.add(0, supersaw([38, 50, 57], at.goesBlack + 0.3, { cutoff: (t) => 180 * 14 ** rise(t), attack: 1.5, release: 0.1, detune: 18 }), 0.45, { pump: true, verb: 0.2 });
    range(0, g.beats * 4).forEach((step) => {
      const time = g.at(step / 4);
      const progress = rise(time);
      intro.add(time, sawPluck([62, 65, 69, 74][step % 4]! + (step % 8 >= 4 ? 12 : 0), 0.3, { open: 500 + 3500 * progress ** 2 }), 0.05 + 0.12 * progress, { pan: step % 2 ? 0.35 : -0.35, delay: 0.25 });
    });
    range(6, g.beats).forEach((beat) => {
      intro.add(g.at(beat), drums.kick, 0.25 + 0.35 * (beat / g.beats));
      intro.pumpAt(g.at(beat));
    });
    roll(intro, g, 12, g.beats, { from: 0.05, to: 0.3 });
    intro.add(at.goesBlack - 2.4, riser(2.4), 0.45);
    intro.add(g.at(g.beats - 4), tonalRiser([50, 57], 4 * g.beat), 0.25);
  }

  private statement() {
    const { at, drums } = this;
    const hits = new Buses(at.seconds);
    at.landings.forEach((time, index) => {
      hits.add(time, drums.clap, 0.25, { verb: 0.5 });
      if (index < at.stressed) return;
      const hardest = index === at.stressed;
      hits.add(time, drums.bigKick, hardest ? 0.9 : 0.55);
      hits.add(time, boom().subarray(0, Math.round(1.4 * 48_000)), hardest ? 0.85 : 0.55);
      if (hardest) hits.add(time, supersaw(DM.chord, 0.7, { cutoff: (t) => 600 + 6000 * Math.exp(-t * 5), release: 0.5 }), 0.4, { verb: 0.6 });
    });
    return hits.bounce();
  }

  private picture() {
    const { at, main, drums } = this;
    const g = grid(at.logo - (8 * 60) / TEMPO, at.logo, TEMPO);
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
    main.add(at.picture, riser(at.logo - at.picture), 0.3);
  }

  private logo(firstBeat: Grid) {
    const { at, main, drums } = this;
    main.add(at.logo, drums.bigKick, 0.9);
    main.add(at.logo, boom(), 1);
    main.add(at.logo, crash(), 0.4, { verb: 0.3 });
    main.add(at.logo, supersaw([38, ...DM.chord, 74], 2.6, { cutoff: (t) => 700 + 7000 * Math.exp(-t * 2.2), attack: 0.004, release: 1.8 }), 0.5, { verb: 0.5 });
    main.add(at.logo + 0.6, supersaw(DM.chord, at.show - at.logo - 0.6, { cutoff: 900, attack: 1.2, release: 0.3, voices: 5 }), 0.28, { verb: 0.3 });
    main.add(at.logo, subBass(38, at.show - at.logo, 0.01, 1), 0.3);
    main.add(at.show - 4 * firstBeat.beat, swell(4 * firstBeat.beat), 0.25);
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
    [at.point, at.overview, at.ask].forEach((time) => this.accent(g, time));
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
    [at.terminals, at.groups].forEach((time) => this.accent(g, time));
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
    `${output}: ${at.seconds.toFixed(1)} s; black at ${at.goesBlack.toFixed(2)} s, picture at ${at.picture.toFixed(2)} s, logo at ${at.logo.toFixed(2)} s, groove from ${at.show.toFixed(2)} s, drop at ${at.review.toFixed(2)} s, montage from ${at.montage.toFixed(2)} s, breakdown at ${at.plugins.toFixed(2)} s, voice at ${at.voice.toFixed(2)} s, last chord at ${at.lastChord.toFixed(2)} s, end card at ${at.ending.toFixed(2)} s`,
  );
}

if (import.meta.main) compose();
