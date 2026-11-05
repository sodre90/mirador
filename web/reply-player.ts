import { useSyncExternalStore } from "react";
import type { StoredEvent } from "../shared/model.ts";
import type { Chime } from "../shared/spoken-conversation.ts";
import { lastReply, spokenTurn } from "../shared/spoken-replies.ts";
import type { TimelineBlock } from "../shared/timeline.ts";
import { connection, type ConnectionStatus } from "./connection.ts";
import { refusalText } from "./host-error.ts";
import { t } from "./i18n/index.ts";

/** A reply being read aloud, by its timeline block's key: summed up first, then spoken a sentence at a time. */
export interface ReplyReading {
  conversationId: string;
  key: string;
  phase: "summing-up" | "speaking";
}

interface ReadingProblem {
  conversationId: string;
  key: string;
  problem: string;
}

interface Snapshot {
  reading: ReplyReading | null;
  problem: ReadingProblem | null;
}

/** The conversation whose last message this page dictated, and the last event it had when sending it. */
interface AwaitedReply {
  conversationId: string;
  afterSeq: number;
}

const RESUME_WAIT_MS = 500;
const MAX_KEPT_SUMMARIES = 20;

export const AUDIO_BLOCKED = "The browser didn't let Mirador play sound. The reply's play button reads it aloud.";

let context: AudioContext | null = null;
let snapshot: Snapshot = { reading: null, problem: null };
let stopCurrent: (() => void) | null = null;
let awaited: AwaitedReply | null = null;
const listeners = new Set<() => void>();

/** A reply's summary and its sentences' sound, kept so that hearing it again starts at once, in the same words. */
interface KeptSummary {
  sentences: string[];
  sounds: AudioBuffer[];
}

/** By reply and by how replies are read, so that other settings make a summary of their own; the least recently heard go first. */
const keptSummaries = new Map<string, KeptSummary>();

function keptSummary(id: string) {
  const kept = keptSummaries.get(id);
  if (!kept) return null;
  keptSummaries.delete(id);
  keptSummaries.set(id, kept);
  return kept;
}

function keep(id: string, summary: KeptSummary) {
  keptSummaries.set(id, summary);
  if (keptSummaries.size > MAX_KEPT_SUMMARIES) keptSummaries.delete(keptSummaries.keys().next().value!);
  return summary;
}

function publish(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useReplyReading = () => useSyncExternalStore(subscribe, () => snapshot);

/** Called in a press or click: a browser lets a page start sound later, as when a reply ends, only once a gesture has let it. */
export function allowReplyAudio() {
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume();
}

const problemOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function posted(conversationId: string, path: string, text: string, signal: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(`/conversations/${conversationId}/${path}`, { method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8" }, body: text, signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(t.dictation.replyDidNotReachMirador(problemOf(error)));
  }
  if (!response.ok) throw new Error(await refusalText(response, t.dictation.readingAloudFailed(String(response.status))));
  return response;
}

async function summary(conversationId: string, reply: string, signal: AbortSignal) {
  const { sentences } = (await (await posted(conversationId, "reply-summary", reply, signal)).json()) as { sentences: string[] };
  return sentences;
}

/** Kept only once it says something, so that hearing the reply again asks the voice model again. */
async function sayable(conversationId: string, reply: string, signal: AbortSignal) {
  const sentences = await summary(conversationId, reply, signal);
  if (sentences.length === 0) throw new Error("The voice model found nothing in the reply to say.");
  return sentences;
}

async function spokenSentence(conversationId: string, sentence: string, signal: AbortSignal) {
  const sound = await (await posted(conversationId, "spoken-sentence", sentence, signal)).arrayBuffer();
  return context!.decodeAudioData(sound);
}

/** Safari suspends sound in a page left in the background; a browser that won't let it resume until a gesture says so. */
async function audible() {
  if (context!.state !== "running") await Promise.race([context!.resume(), new Promise((resolve) => setTimeout(resolve, RESUME_WAIT_MS))]);
  if (context!.state !== "running") throw new Error(AUDIO_BLOCKED);
}

async function played(sound: AudioBuffer, onSource: (source: AudioBufferSourceNode) => void) {
  await audible();
  return new Promise<void>((resolve) => {
    const source = context!.createBufferSource();
    source.buffer = sound;
    source.connect(context!.destination);
    source.onended = () => resolve();
    onSource(source);
    source.start();
  });
}

/** Made while the sentence before it plays, so that the reply is heard as one; a sentence never awaited fails quietly. */
function inAdvance<T>(making: Promise<T>) {
  making.catch(() => {});
  return making;
}

/** Sums the reply up and speaks it, starting as soon as the first sentence is ready; reading another reply stops this one. Tells whether it was heard to the end. */
export async function readReply(conversationId: string, key: string, reply: string, readingAs: string) {
  const id = JSON.stringify([conversationId, key, reply, readingAs]);
  return speak(conversationId, key, async (signal) => keptSummary(id) ?? keep(id, { sentences: await sayable(conversationId, reply, signal), sounds: [] }));
}

/** Speaks these sentences as they are, without summing them up, as a question asked aloud is; tells whether they were heard to the end. */
export function sayAloud(conversationId: string, key: string, sentences: string[]) {
  const id = JSON.stringify([conversationId, key, sentences]);
  return speak(conversationId, key, async () => keptSummary(id) ?? keep(id, { sentences, sounds: [] }));
}

async function speak(conversationId: string, key: string, summary: (signal: AbortSignal) => Promise<KeptSummary>) {
  stopReading();
  allowReplyAudio();
  const aborts = new AbortController();
  let source: AudioBufferSourceNode | null = null;
  const stop = () => {
    aborts.abort();
    source?.stop();
  };
  stopCurrent = stop;
  const reading: ReplyReading = { conversationId, key, phase: "summing-up" };
  publish({ reading, problem: null });
  try {
    const { sentences, sounds } = await summary(aborts.signal);
    const soundOf = async (index: number) => (sounds[index] ??= await spokenSentence(conversationId, sentences[index]!, aborts.signal));
    let next = inAdvance(soundOf(0));
    for (const index of sentences.keys()) {
      const sound = await next;
      if (index + 1 < sentences.length) next = inAdvance(soundOf(index + 1));
      if (aborts.signal.aborted) return false;
      if (snapshot.reading?.phase !== "speaking") publish({ reading: { ...reading, phase: "speaking" } });
      await played(sound, (playing) => (source = playing));
      if (aborts.signal.aborted) return false;
    }
    return true;
  } catch (error) {
    if (!aborts.signal.aborted) publish({ problem: { conversationId, key, problem: problemOf(error) } });
    return false;
  } finally {
    if (stopCurrent === stop) {
      stopCurrent = null;
      publish({ reading: null });
    }
  }
}

export function stopReading() {
  stopCurrent?.();
}

/** Stops what is being read only when it is this. */
export function stopReadingOf(conversationId: string, key: string) {
  if (snapshot.reading?.conversationId === conversationId && snapshot.reading.key === key) stopReading();
}

/** Stops what is being read for this conversation, while a reply of another reads on. */
export function stopReadingAloudIn(conversationId: string) {
  if (snapshot.reading?.conversationId === conversationId) stopReading();
}

/** What went wrong reading this aloud, when it did. */
export function readingProblemOf(conversationId: string, key: string) {
  const problem = snapshot.problem;
  return problem?.conversationId === conversationId && problem.key === key ? problem.problem : null;
}

/** As when the user switches away from the conversation: a reply of another conversation reads on. */
export function stopReadingIn(conversationId: string) {
  stopReadingAloudIn(conversationId);
  forgetSpokenReply(conversationId);
}

const TICKS_EVERY_MS = 15_000;
let ticking: ReturnType<typeof setInterval> | null = null;

/** In a spoken conversation, a clock tells while the agent works that it is still at it, so that silence isn't a mystery. */
export function tickTheClock(on: boolean) {
  if (ticking) clearInterval(ticking);
  ticking = on ? setInterval(() => connection.status === "open" && clockTicks(), TICKS_EVERY_MS) : null;
}

/** The turn the message starts gets its last reply read aloud when it ends. */
export function awaitSpokenReply(conversationId: string, events: StoredEvent[]) {
  awaited = { conversationId, afterSeq: events.at(-1)?.seq ?? 0 };
}

/** As when a message the user typed starts the conversation's next turn; another pane's dictated message still gets its reply read. */
export function forgetSpokenReply(conversationId: string) {
  if (awaited?.conversationId === conversationId) awaited = null;
}

let lastStatus: ConnectionStatus = connection.status;

/** Losing the host while the clock ticks would otherwise sound just like the agent working on. */
connection.onStatus((status) => {
  if (lastStatus === "open" && status !== "open" && ticking) connectionLostTones();
  lastStatus = status;
});

/** Reads the last reply aloud once the turn a dictated message started ends, for the page that dictated it. */
export function readWhenSpokenTurnEnds(conversationId: string, events: StoredEvent[], timeline: TimelineBlock[], readingAs: string | null) {
  if (awaited?.conversationId !== conversationId) return;
  const outcome = spokenTurn(events, awaited.afterSeq);
  if (outcome === "going-on") return;
  awaited = null;
  const reply = outcome === "ended" ? lastReply(timeline) : null;
  if (reply && readingAs) void readReply(conversationId, reply.key, reply.text, readingAs);
}

const CHIME_SECONDS = 0.18;
const CHIME_VOLUME = 0.45;


const soundPlays = () => context?.state === "running";

/** A pitch gliding from one frequency to another, rising to its volume at once and fading out by its end. */
function tone(from: number, to: number, at: number, seconds: number, loudness: number, shape: OscillatorType = "sine") {
  const sound = context!.createOscillator();
  const volume = context!.createGain();
  sound.type = shape;
  sound.frequency.setValueAtTime(from, at);
  sound.frequency.exponentialRampToValueAtTime(to, at + seconds);
  volume.gain.setValueAtTime(0.0001, at);
  volume.gain.exponentialRampToValueAtTime(loudness, at + Math.min(0.02, seconds / 10));
  volume.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  sound.connect(volume).connect(context!.destination);
  sound.start(at);
  sound.stop(at + seconds);
}

const chimeGlides: Record<Chime, [number, number]> = { listening: [660, 990], heard: [880, 520], trouble: [300, 200] };

/** Resolves once it has played, at once when the page can't play sound; by the clock, as a context suspended meanwhile would never end the tone. */
export function chime(kind: Chime) {
  if (!soundPlays()) return Promise.resolve();
  const [from, to] = chimeGlides[kind];
  tone(from, to, context!.currentTime, CHIME_SECONDS, CHIME_VOLUME);
  return new Promise<void>((resolve) => setTimeout(resolve, CHIME_SECONDS * 1000));
}

const CLOCK_BEATS = 4;
const CLOCK_BEAT_SECONDS = 1;
const CLOCK_CLICK_SECONDS = 0.025;
const CLOCK_VOLUME = 0.9;

/** A wooden mantel clock: a noise click through the escapement's ring and the case's body, the tock lower and softer. */
const clockBeats = {
  tick: { click: 2_600, body: 520, loudness: 0.9 },
  tock: { click: 1_900, body: 420, loudness: 0.7 },
};

let clickNoise: AudioBuffer | null = null;
const beatsToCome = new Set<AudioBufferSourceNode>();
let microphonesListening = 0;

function noise() {
  if (clickNoise) return clickNoise;
  clickNoise = context!.createBuffer(1, Math.ceil(context!.sampleRate * CLOCK_CLICK_SECONDS * 3), context!.sampleRate);
  const samples = clickNoise.getChannelData(0);
  for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
  return clickNoise;
}

function decaying(at: number, loudness: number, seconds: number) {
  const volume = context!.createGain();
  volume.gain.setValueAtTime(0.0001, at);
  volume.gain.exponentialRampToValueAtTime(loudness, at + 0.002);
  volume.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  volume.connect(context!.destination);
  return volume;
}

function resonance(pitch: number, sharpness: number, at: number) {
  const filter = context!.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(pitch, at);
  filter.Q.value = sharpness;
  return filter;
}

function clockBeat({ click, body, loudness }: (typeof clockBeats)["tick"], at: number) {
  const sound = context!.createBufferSource();
  sound.buffer = noise();
  sound.connect(resonance(click, 3, at)).connect(decaying(at, loudness * CLOCK_VOLUME, CLOCK_CLICK_SECONDS));
  sound.connect(resonance(body, 12, at)).connect(decaying(at, loudness * CLOCK_VOLUME * 1.3, CLOCK_CLICK_SECONDS * 2.2));
  sound.start(at);
  sound.stop(at + CLOCK_CLICK_SECONDS * 3);
  beatsToCome.add(sound);
  sound.addEventListener("ended", () => beatsToCome.delete(sound));
}

/** Tick-tock, tick-tock, as the agent works on what was dictated. */
function clockTicks() {
  if (!soundPlays() || microphonesListening > 0) return;
  const at = context!.currentTime;
  for (let beat = 0; beat < CLOCK_BEATS; beat++) clockBeat(beat % 2 === 0 ? clockBeats.tick : clockBeats.tock, at + beat * CLOCK_BEAT_SECONDS);
}

/** The microphone would hear the clock, so it keeps quiet while one listens, until what this gives back is called. */
export function quietClock() {
  microphonesListening++;
  beatsToCome.forEach((beat) => beat.stop());
  return () => {
    microphonesListening--;
  };
}

/** Two low falling tones: the page lost the host, so no reply is coming until it reconnects. */
function connectionLostTones() {
  if (!soundPlays()) return;
  const at = context!.currentTime;
  tone(330, 250, at, 0.3, CHIME_VOLUME);
  tone(250, 180, at + 0.35, 0.4, CHIME_VOLUME);
}
