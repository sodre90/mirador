import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CROSSFADE_FRAMES, FRAME } from "../src/brand.ts";
import { spokenSpans } from "../src/mix.ts";
import { STORYBOARD, TEMPO } from "../src/storyboard.ts";
import { CANVAS_AT } from "../src/Trailer.tsx";
import type { ClipInfo, NarrationLine } from "../src/timeline.ts";
import { placeScenes } from "../src/timeline.ts";
import {
  boom, Buses, carve, clap, crash, fadeOut, grid, hat, kick, lead, limit, Mix, phrase, pluck, range, riser, roll, sawPluck, shape, snare, sparkle, subBass, subsonic, supersaw, swell, synthBass, tonalRiser, whoosh, writeWav, type Grid,
} from "./synth.ts";

/**
 * The Mirador trailer score (120 BPM, exact 0.5 s beats):
 * - Hook (0–8 s): tense pulsing bass + rising arp under the wall of text, sparkling crystalline flip at CANVAS_AT,
 *   building into a warm sub-impact on Chapter 01.
 * - Act 1 (Canvas & Ask): sleek half-time synth groove in D minor (Dm9 · Fmaj7 · Cadd9 · Gm7).
 * - Act 2 (Review & Side Chat): four-on-the-floor energy with melodic synth hook.
 * - Act 3 (Worktrees, Fork & Multi-Agent): driving peak with octave-doubled hook & crisp percussion.
 * - Act 4 (Jobs, Plugins/Media & P2P): modulates up a step to E minor (Em9 · Gmaj7 · Dadd9 · Am7), building directly
 *   into a luminous E major 9 resolution on the End Card with no blank pause.
 * - Heavy sub-booms land only on major Act transitions; intra-act chapter cuts use lighter percussive lifts.
 */
const video = join(import.meta.dirname, "..");
const output = join(video, "public", "music", "score.wav");
const SLAM_BOOM_SECONDS = 0.65;
const LEVEL = 10 ** (-1.1 / 20);

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
    hook: startOf("hook"),
    flip: startOf("hook") + CANVAS_AT,
    act1: startOf("showPoint"),
    act2: startOf("review"),
    act3: startOf("worktree"),
    act4: startOf("jobs"),
    p2p: startOf("p2p"),
    slams: placed.filter(({ scene }) => scene.slam).map(({ scene, from }) => ({ id: scene.id, time: from / FRAME.fps })),
    ending: startOf("end"),
    spoken: spokenSpans(placed, lines, FRAME.fps).map(({ from, to }) => ({ from: from / FRAME.fps, to: to / FRAME.fps })),
  };
}
type Moments = ReturnType<typeof timeline>;

const DM9 = { chord: [50, 57, 60, 64, 65, 69], bass: 38, arp: [62, 65, 69, 76] };
const FMAJ7 = { chord: [48, 53, 57, 60, 64, 69], bass: 41, arp: [60, 65, 69, 72] };
const CADD9 = { chord: [48, 52, 55, 60, 62, 67], bass: 36, arp: [60, 64, 67, 74] };
const GM7 = { chord: [50, 55, 58, 62, 65, 67], bass: 43, arp: [58, 62, 67, 70] };
type Chord = typeof DM9;
const up = ({ chord, bass, arp }: Chord, semitones: number): Chord => ({
  chord: chord.map((note) => note + semitones),
  bass: bass + semitones,
  arp: arp.map((note) => note + semitones),
});
const PROGRESSION = [DM9, FMAJ7, CADD9, GM7];

/** Melodic synth hook across four bars: [sixteenth, midi note, sixteenths long]. */
const HOOK: [number, number, number][] = [
  [0, 74, 2], [2, 76, 2], [4, 77, 3], [7, 76, 1], [8, 74, 2], [10, 72, 2], [12, 69, 4],
  [16, 72, 2], [18, 74, 2], [20, 77, 3], [23, 76, 1], [24, 74, 2], [26, 72, 2], [28, 76, 4],
  [32, 79, 2], [34, 77, 2], [36, 76, 3], [39, 74, 1], [40, 72, 2], [42, 74, 2], [44, 76, 4],
  [48, 77, 3], [51, 76, 1], [52, 74, 2], [54, 72, 2], [56, 74, 8],
];
const hookBars = (fromBar: number, toBar: number) =>
  HOOK.filter(([step]) => step >= fromBar * 16 && step < toBar * 16).map(([step, note, length]): [number, number, number] => [step - fromBar * 16, note, length]);

const drumKit = () => ({
  kick: kick({ punch: 135, decay: 8 }),
  bigKick: kick({ punch: 175, decay: 5.5, seconds: 0.65 }),
  clap: clap(),
  snare: snare({ decay: 18 }),
  closedHat: hat(85),
  softHat: hat(130),
  openHat: hat(16),
});

class Score {
  private readonly drums = drumKit();
  private readonly main: Buses;

  constructor(private readonly at: Moments) {
    this.main = new Buses(at.seconds);
  }

  render() {
    const { at } = this;
    this.intro();
    this.actOne();
    this.actTwo();
    this.actThree();
    this.actFour();
    this.transitions();
    this.ending();
    const mix = new Mix(at.seconds);
    mix.addStereo(0, this.main.bounce({ depth: 0.58, release: 0.24, delaySeconds: (0.75 * 60) / TEMPO, feedback: 0.34 }), 1);
    subsonic(mix);
    limit(mix, 11.5);
    carve(mix, at.spoken, 6.5);
    fadeOut(mix, 1.6);
    return mix;
  }

  /** Hook: tense wall-of-text pulse -> crystalline flip to the car mode phones -> build into Chapter 01. */
  private intro() {
    const { at, main, drums } = this;
    const g = grid(at.hook, at.act1, TEMPO, true);
    main.add(at.hook, subBass(38, at.flip - at.hook), 0.34);
    main.add(at.hook, supersaw(DM9.chord, at.flip - at.hook + 0.1, { cutoff: (t) => 380 * 3.5 ** (t / 3.2), attack: 0.35, release: 0.08 }), 0.26, { verb: 0.3 });
    range(0, 12).forEach((step) => {
      const t = at.hook + step * (g.beat / 2);
      if (t < at.flip - 0.1) main.add(t, synthBass(50, 0.14, { open: 700 + step * 80 }), 0.15);
    });
    main.add(Math.max(0, at.flip - 0.55), whoosh(0.55, -0.65, 0.65), 0.42, { verb: 0.2 });
    main.add(at.flip, drums.bigKick, 0.72);
    main.add(at.flip, sparkle([74, 81, 86], 0.075, 1.5), 0.36, { delay: 0.3, verb: 0.35 });

    const afterFlip = at.act1 - at.flip;
    main.add(at.flip, supersaw(FMAJ7.chord, afterFlip * 0.52, { cutoff: (t) => 700 + 2200 * (t / 2.2), attack: 0.08, release: 0.12 }), 0.34, { pump: true, verb: 0.3 });
    main.add(at.flip + afterFlip * 0.5, supersaw(CADD9.chord, afterFlip * 0.52, { cutoff: (t) => 1600 * 3 ** (t / 2.4), attack: 0.02, release: 0.05 }), 0.36, { pump: true, verb: 0.32 });
    range(8, g.beats).forEach((beat) => {
      main.add(g.at(beat), drums.kick, 0.48);
      main.pumpAt(g.at(beat));
    });
    range(16, g.beats * 4).forEach((step) => {
      const chord = step < 48 ? FMAJ7 : CADD9;
      const note = chord.arp[step % 4]! + 12 * Math.floor((step % 16) / 8);
      main.add(g.at(step / 4), sawPluck(note, 0.28, { open: 1400 + 2200 * ((step - 16) / 48) }), 0.065 + 0.055 * ((step - 16) / 48), { pan: step % 2 ? 0.38 : -0.38, delay: 0.32 });
    });
    roll(main, g, g.beats - 2, g.beats, { from: 0.06, to: 0.26 });
    main.add(g.at(g.beats - 4), tonalRiser([62, 69], 4 * g.beat), 0.22, { verb: 0.22 });
    main.add(at.flip, riser(afterFlip), 0.24);
  }

  private harmony(g: Grid, bar: number, chord: Chord, { bars = 1, cutoff = 2400 as number | ((t: number) => number), gain = 0.26, rolling = true, arp = false, arpGain = 0.055, ringsOn = 0 } = {}) {
    const { main } = this;
    main.add(g.at(bar * 4), supersaw(chord.chord, bars * g.bar + 0.04 + ringsOn, { cutoff, attack: 0.018, release: ringsOn ? ringsOn * 0.85 : 0.06 }), gain, { pump: true, verb: 0.18 });
    range(0, bars).forEach((offset) => {
      const barStart = bar + offset;
      main.add(g.at(barStart * 4), subBass(chord.bass, g.bar - 0.02), 0.3, { pump: true });
      if (rolling)
        range(0, 16)
          .filter((step) => step % 4 !== 0)
          .forEach((step) => main.add(g.at(barStart * 4 + step / 4), synthBass(chord.bass + 12 + (step % 4 === 2 ? 12 : 0), g.beat / 4.2), 0.19, { pump: true }));
      if (arp)
        range(0, 16).forEach((step) =>
          main.add(g.at(barStart * 4 + step / 4), sawPluck(chord.arp[(step * 3) % 4]! + (step >= 8 ? 12 : 0), 0.24), arpGain, { pan: step % 2 ? 0.42 : -0.42, delay: 0.3 }),
        );
    });
  }

  private halfTime(g: Grid, bar: number, busy: boolean) {
    const { main, drums } = this;
    const beatAt = (offset: number) => g.at(bar * 4 + offset);
    [0, 1.5, ...(busy ? [2.75] : [])].forEach((offset) => main.add(beatAt(offset), drums.kick, 0.52));
    main.add(beatAt(2), drums.snare, 0.28, { verb: 0.2 });
    if (busy) main.add(beatAt(2), drums.clap, 0.16, { verb: 0.2 });
    range(0, busy ? 16 : 8).forEach((step) =>
      main.add(beatAt(step / (busy ? 4 : 2)), step % 2 ? drums.closedHat : drums.softHat, busy ? (step % 2 ? 0.045 : 0.03) : 0.03, { pan: step % 2 ? 0.28 : -0.28 }),
    );
    if (busy) main.add(beatAt(3.5), drums.openHat, 0.045, { pan: 0.2 });
    main.pumpAt(...range(0, 4).map(beatAt));
  }

  private fourOnTheFloor(g: Grid, bar: number) {
    const { main, drums } = this;
    const beatAt = (offset: number) => g.at(bar * 4 + offset);
    range(0, 4).forEach((offset) => {
      main.add(beatAt(offset), drums.kick, 0.56);
      main.add(beatAt(offset + 0.5), drums.openHat, 0.045, { pan: 0.2 });
    });
    [1, 3].forEach((offset) => main.add(beatAt(offset), drums.clap, 0.26, { pan: offset === 1 ? -0.1 : 0.1, verb: 0.16 }));
    range(0, 16).forEach((step) =>
      main.add(beatAt(step / 4), step % 4 === 2 ? drums.closedHat : drums.softHat, step % 4 === 2 ? 0.045 : 0.025, { pan: step % 2 ? 0.28 : -0.28 }),
    );
    main.pumpAt(...range(0, 4).map(beatAt));
  }

  private playHook(g: Grid, bar: number, fromHookBar: number, toHookBar: number, transpose = 0, octave = false) {
    if (bar + toHookBar - fromHookBar > g.bars) return;
    const notes = phrase(g, bar * 4, hookBars(fromHookBar, toHookBar), transpose);
    this.main.add(g.at(bar * 4), lead(notes), 0.17, { delay: 0.34, verb: 0.25 });
    if (octave) this.main.add(g.at(bar * 4), lead(notes.map((note) => ({ ...note, note: note.note + 12 })), { square: 0.12, cutoff: 1900 }), 0.075, { delay: 0.34, verb: 0.25, pan: 0.18 });
  }

  /** Act 1 (Canvas & Ask): sleek half-time synth groove building smoothly into Act 2. */
  private actOne() {
    const { at, main, drums } = this;
    const g = grid(at.act1, at.act2, TEMPO, true);
    main.add(at.act1, drums.bigKick, 0.85);
    main.add(at.act1, boom(2.4), 0.82);
    main.add(at.act1, crash(2.2), 0.32, { verb: 0.28 });
    const buildFrom = Math.max(1, g.bars - 1);
    range(0, g.bars).forEach((bar) => {
      const chord = PROGRESSION[bar % 4]!;
      const building = bar >= buildFrom;
      this.harmony(g, bar, chord, {
        cutoff: building ? (t) => 1800 * 3.8 ** (t / g.bar) : bar >= 3 ? 2100 : 1200,
        gain: building ? 0.27 : 0.22,
        rolling: bar >= 2,
        arp: bar >= 2,
        arpGain: building ? 0.075 : 0.05,
      });
      if (!building) return this.halfTime(g, bar, bar >= 3);
      [0, 1, 2].forEach((offset) => main.add(g.at(bar * 4 + offset), drums.kick, 0.52));
      main.pumpAt(...range(0, 4).map((offset) => g.at(bar * 4 + offset)));
    });
    roll(main, g, buildFrom * 4, g.beats, { from: 0.06, to: 0.28 });
    main.add(g.at(buildFrom * 4), riser(g.bar), 0.22);
  }

  /** Act 2 (Review & Side Chat): four-on-the-floor with melodic synth hook. */
  private actTwo() {
    const { at, main } = this;
    const g = grid(at.act2, at.act3, TEMPO, true);
    range(0, g.bars).forEach((bar) => {
      this.harmony(g, bar, PROGRESSION[bar % 4]!, { cutoff: 4200, gain: 0.28, arp: true });
      this.fourOnTheFloor(g, bar);
    });
    this.playHook(g, 0, 0, Math.min(4, g.bars));
    if (g.bars >= 8) this.playHook(g, 4, 0, 4);
    main.add(at.act3 - 2 * g.beat, swell(2 * g.beat), 0.18);
  }

  /** Act 3 (Plugins/Media & Multi-Agent): peak driving energy with octave-doubled hook. */
  private actThree() {
    const { at, main, drums } = this;
    const g = grid(at.act3, at.act4, TEMPO, true);
    const lastBar = g.bars - 1;
    range(0, g.bars).forEach((bar) => {
      this.harmony(g, bar, PROGRESSION[bar % 4]!, { cutoff: bar === lastBar ? (t) => 1600 * 3.8 ** (t / g.bar) : 5600, gain: 0.3, arp: true, arpGain: 0.065 });
      this.fourOnTheFloor(g, bar);
      if (bar >= Math.floor(g.bars / 2)) range(0, 4).forEach((offset) => main.add(g.at(bar * 4 + offset + 0.5), drums.snare, 0.04, { verb: 0.1 }));
    });
    this.playHook(g, 0, 0, Math.min(4, g.bars), 0, true);
    if (g.bars >= 8) this.playHook(g, 4, 0, 4, 0, true);
    roll(main, g, lastBar * 4, g.beats, { from: 0.04, to: 0.18 });
    main.add(at.act4 - 2 * g.beat, swell(2 * g.beat), 0.18);
  }

  /** Act 4 (Jobs, Plugins/Media & P2P): modulates up a whole step to E minor and builds straight into the End Card. */
  private actFour() {
    const { at, main } = this;
    const g = grid(at.act4, at.ending, TEMPO, true);
    const lifted = PROGRESSION.map((chord) => up(chord, 2));
    const lastBar = g.bars - 1;
    range(0, g.bars).forEach((bar) => {
      const last = bar === lastBar;
      this.harmony(g, bar, lifted[bar % 4]!, {
        cutoff: last ? (t) => 2200 * 2.4 ** (t / g.bar) : 2800,
        gain: 0.25,
        arp: true,
        arpGain: 0.055,
      });
      this.fourOnTheFloor(g, bar);
    });
    main.add(at.p2p + 0.4, sparkle([76, 83, 88], 0.08, 1.4), 0.26, { delay: 0.3, verb: 0.35 });
    roll(main, g, lastBar * 4 + 2, g.beats, { from: 0.05, to: 0.22 });
    main.add(at.ending - 2 * g.beat, swell(2 * g.beat), 0.2);
  }

  /** Heavy sub-booms land on Act boundaries; intra-act chapter cuts use lighter stereo lifts to avoid fatigue. */
  private transitions() {
    const { at, main, drums } = this;
    const majorActs = new Set(["review", "worktree", "jobs"]);
    const slamBoom = shape(boom(SLAM_BOOM_SECONDS), (t) => Math.min(1, (SLAM_BOOM_SECONDS - t) / 0.03));
    at.slams.filter(({ time }) => time > at.act1).forEach(({ id, time }, index) => {
      const dir = index % 2 === 0 ? 1 : -1;
      if (majorActs.has(id)) {
        main.add(Math.max(0, time - 0.32), whoosh(0.46, -0.5 * dir, 0.5 * dir), 0.3, { verb: 0.18 });
        main.add(time, drums.bigKick, 0.56);
        main.add(time, crash(1.7), 0.19, { verb: 0.22 });
        main.add(time, slamBoom, 0.36);
      } else {
        main.add(Math.max(0, time - 0.22), whoosh(0.28, -0.35 * dir, 0.35 * dir), 0.15, { verb: 0.12 });
        main.add(time, drums.kick, 0.42);
      }
    });
  }

  /** Lush E major 9 resolution on the End Card with sparkling arpeggiated bell plucks. */
  private ending() {
    const { at, main, drums } = this;
    const eMajor9 = [40, 52, 59, 64, 66, 68, 71, 78];
    main.add(Math.max(0, at.ending - 0.35), whoosh(0.45, -0.4, 0.4), 0.3, { verb: 0.2 });
    main.add(at.ending, drums.bigKick, 0.85);
    main.add(at.ending, boom(2.8), 0.95);
    main.add(at.ending, crash(3), 0.36, { verb: 0.4 });
    main.add(at.ending, supersaw(eMajor9, at.seconds - at.ending, { cutoff: (t) => 900 + 5200 * Math.exp(-t * 2.3), attack: 0.005, release: 3.2 }), 0.46, { verb: 0.52 });
    main.add(at.ending, subBass(28, 3.2, 0.005, 2.5), 0.38);
    [76, 80, 83, 88, 90, 95].forEach((note, index) =>
      main.add(at.ending + 0.75 + index * 0.18, pluck(note, 2.8, 1.4), 0.18, { pan: index % 2 ? 0.38 : -0.38, delay: 0.4, verb: 0.32 }),
    );
  }
}

function compose() {
  const at = timeline();
  writeWav(output, new Score(at).render(), LEVEL);
  console.log(
    `${output}: ${at.seconds.toFixed(1)} s; flip at ${at.flip.toFixed(2)} s, act1 ${at.act1.toFixed(2)} s, act2 ${at.act2.toFixed(2)} s, act3 ${at.act3.toFixed(2)} s, act4 ${at.act4.toFixed(2)} s, end ${at.ending.toFixed(2)} s`,
  );
}

if (import.meta.main) compose();
