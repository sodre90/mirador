/** A box in the app's own points (1536 x 864), as the capture measured it. */
export type Rect = { x: number; y: number; width: number; height: number };

/** A filmed clip: its length, its named moments in seconds from its start, and the boxes the camera can move to. */
export type ClipInfo = { name: string; seconds: number; moments: Record<string, number>; rects: Record<string, Rect> };

/** A point in a clip: seconds from its start, a moment's name, or a moment's name with seconds before (-) or after (+). */
export type ClipTime = number | string | [string, number];

/**
 * A stretch of a clip, played at a speed: typing can run faster than the agent's answer. It comes in over the last frame
 * of the shot before for `fadeInFrames` frames, or cuts straight to it.
 */
export type Shot = { from: ClipTime; to: ClipTime; speed?: number; fadeInFrames?: number };

/** Where the camera looks from a point of the clip on: the whole app, one of the clip's boxes, or a box given here, at a zoom. */
export type CameraKey = { at: ClipTime; look: "app" | string | Rect; zoom?: number };

/** A scene's idea in a few words, on the side of the frame away from where the scene happens. */
export type Caption = { kicker: string; title: string; at?: number; seconds?: number; side?: "left" | "right" };

/**
 * A line of narration (narration/lines.ts) and when in its scene it starts, in seconds. In a clip scene, `from` names
 * a point of the clip that `at` counts from, so a line keeps to what it goes with however the shots speed the clip up.
 * The music dips under it to `musicDipsTo` of its volume, or the trailer's usual dip: a shallower one keeps a fast
 * section's beat going.
 */
export type Spoken = { line: string; at: number; from?: ClipTime; musicDipsTo?: number };

/** A line of narration with its start in seconds of its scene. */
export type PlacedLine = { line: string; at: number; musicDipsTo?: number };

/**
 * Words shown large, landing part by part as the narrator says them: its line starts at `at`, and each part lands
 * `after` seconds into it, as the narrator reaches it. A `stressed` part stands out.
 */
export type Statement = { at: number; parts: { words: string; after: number; stressed?: boolean }[] };

/** When each part of a statement lands, in seconds of its scene. */
export const statementBeats = ({ parts, at }: Statement) => parts.map(({ after }) => at + after);

/** How a scene comes in: over the one before it for `fadeInFrames` frames (0 cuts straight to it), the trailer's crossfade by default. */
type Transition = { fadeInFrames?: number };

/** A clip scene lasts as long as its shots, or `seconds` when given: shorter cuts the footage, longer holds its last frame. */
export type ClipScene = Transition & { kind: "clip"; id: string; clip: string; shots: Shot[]; camera: CameraKey[]; captions?: Caption[]; narration?: Spoken[]; seconds?: number };
/** The logo, the end card, or the backdrop alone, for a breath before the end card. */
export type CardScene = Transition & { kind: "logo" | "end" | "backdrop"; id: string; seconds: number; narration?: Spoken[] };
/** The wall of text goes black at `goesBlackAt` for the statement to land in, and from `pictureAt` a picture draws itself. */
export type WallScene = Transition & { kind: "text-wall"; id: string; seconds: number; narration?: Spoken[]; goesBlackAt?: number; pictureAt?: number; statement?: Statement };
export type Scene = ClipScene | CardScene | WallScene;

export type NarrationLine = { text: string; file: string; seconds: number };

/**
 * A scene as the composition plays it: where it starts, how long it runs and how long it fades in over the one before,
 * in frames, and its narration's lines, each with its start in seconds of the scene.
 */
export type PlacedScene = { scene: Scene; from: number; frames: number; fadeInFrames: number; lines: PlacedLine[] };

/** How long after a scene's narration ends before the next scene starts, in seconds. */
const NARRATION_TAIL = 0.6;

export function clipSeconds(clip: ClipInfo, time: ClipTime): number {
  if (typeof time === "number") return time;
  const [moment, offset] = typeof time === "string" ? [time, 0] : time;
  const at = clip.moments[moment];
  if (at === undefined) throw new Error(`${clip.name} has no moment "${moment}"; it has ${Object.keys(clip.moments).join(", ")}`);
  return Math.min(clip.seconds, Math.max(0, at + offset));
}

/** Each shot's stretch of the clip and where it plays in the scene, in seconds. */
export function shotsOf(scene: ClipScene, clip: ClipInfo) {
  let sceneAt = 0;
  return scene.shots.map(({ from, to, speed = 1 }) => {
    const clipFrom = clipSeconds(clip, from);
    const clipTo = clipSeconds(clip, to);
    if (clipTo <= clipFrom) throw new Error(`${scene.id}: a shot ends (${clipTo}s) before it starts (${clipFrom}s)`);
    if (clipTo > clip.seconds) throw new Error(`${scene.id}: a shot ends (${clipTo}s) after its clip does (${clip.seconds}s)`);
    const placed = { clipFrom, clipTo, speed, sceneFrom: sceneAt, sceneTo: sceneAt + (clipTo - clipFrom) / speed };
    sceneAt = placed.sceneTo;
    return placed;
  });
}

/**
 * The frames of the clip a shot plays. A shot's scene frames and clip frames are rounded apart, so its last frame can ask
 * for one frame past its stretch of the clip; the trim keeps that frame too, within the clip.
 */
export function shotTrim(shot: { clipFrom: number; clipTo: number }, clip: ClipInfo, fps: number) {
  return { trimBefore: Math.round(shot.clipFrom * fps), trimAfter: Math.min(Math.round(shot.clipTo * fps) + 1, Math.round(clip.seconds * fps)) };
}

/** Where a point of the clip plays in the scene; a point between shots plays where the next shot starts. */
export function sceneSecondsOf(scene: ClipScene, clip: ClipInfo, time: ClipTime) {
  const at = clipSeconds(clip, time);
  const shots = shotsOf(scene, clip);
  const shot = shots.find(({ clipTo }) => at <= clipTo) ?? shots.at(-1)!;
  return shot.sceneFrom + Math.max(0, Math.min(at, shot.clipTo) - shot.clipFrom) / shot.speed;
}

export function narrationLine(narration: Record<string, NarrationLine>, name: string) {
  const line = narration[name];
  if (!line) throw new Error(`No narration line "${name}"; run bun run narrate`);
  return line;
}

/** The scene's lines of narration, each starting in seconds of the scene. */
export function linesOf(scene: Scene, clips: Record<string, ClipInfo>): PlacedLine[] {
  return (scene.narration ?? []).map(({ line, at, from, musicDipsTo }) => {
    if (from === undefined) return { line, at, musicDipsTo };
    if (scene.kind !== "clip") throw new Error(`${scene.id}: only a clip scene's narration can start from a point of its clip`);
    return { line, at: sceneSecondsOf(scene, clipNamed(clips, scene.clip), from) + at, musicDipsTo };
  });
}

/** A scene lasts its footage's length or its own, and longer when its narration needs it: the last frame then holds. */
export function sceneSeconds(scene: Scene, clips: Record<string, ClipInfo>, narration: Record<string, NarrationLine>) {
  const footage = scene.kind === "clip" ? (scene.seconds ?? shotsOf(scene, clipNamed(clips, scene.clip)).at(-1)!.sceneTo) : scene.seconds;
  const spokenUntil = linesOf(scene, clips).map(({ line, at }) => at + narrationLine(narration, line).seconds + NARRATION_TAIL);
  return Math.max(footage, ...spokenUntil);
}

export function clipNamed(clips: Record<string, ClipInfo>, name: string) {
  const clip = clips[name];
  if (!clip) throw new Error(`No clip "${name}" in public/clips; run bun run capture and bun run encode`);
  return clip;
}

/** Scenes one after another, each overlapping the one before by its fade in, `crossfadeFrames` unless it says otherwise. */
export function placeScenes(scenes: Scene[], clips: Record<string, ClipInfo>, narration: Record<string, NarrationLine>, fps: number, crossfadeFrames: number): PlacedScene[] {
  const fadeInOf = (scene: Scene | undefined, index: number) => (!scene || index === 0 ? 0 : (scene.fadeInFrames ?? crossfadeFrames));
  let from = 0;
  return scenes.map((scene, index) => {
    const overlapWithNext = fadeInOf(scenes[index + 1], index + 1);
    const placed = { scene, from, frames: Math.round(sceneSeconds(scene, clips, narration) * fps) + overlapWithNext, fadeInFrames: fadeInOf(scene, index), lines: linesOf(scene, clips) };
    from += placed.frames - overlapWithNext;
    return placed;
  });
}
