import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import { Composition, staticFile, type CalculateMetadataFunction } from "remotion";
import { LINES, textOf, type LineName } from "../narration/lines.ts";
import { CROSSFADE_FRAMES, FRAME } from "./brand.ts";
import { STORYBOARD } from "./storyboard.ts";
import type { ClipInfo, NarrationLine } from "./timeline.ts";
import { placeScenes } from "./timeline.ts";
import { Trailer, type TrailerProps } from "./Trailer.tsx";

async function fetchJson<T>(path: string, missing: string): Promise<T> {
  const response = await fetch(staticFile(path));
  if (!response.ok) throw new Error(`${path} is missing: ${missing}`);
  return (await response.json()) as T;
}

/** The scenes' lengths come from the filmed clips and the narration, so the trailer is timed only once both exist. */
const calculateMetadata: CalculateMetadataFunction<TrailerProps> = async () => {
  const clipNames = [...new Set(STORYBOARD.flatMap((scene) => (scene.kind === "clip" ? [scene.clip] : [])))];
  const clips = Object.fromEntries(await Promise.all(clipNames.map(async (name) => [name, await fetchJson<ClipInfo>(`clips/${name}.json`, "run bun run capture, then bun run encode")] as const)));
  const { lines: narration } = await fetchJson<{ lines: Record<string, NarrationLine> }>("narration/manifest.json", "run bun run narrate");
  const stale = (Object.keys(LINES) as LineName[]).filter((name) => narration[name]?.text !== textOf(name));
  if (stale.length > 0) throw new Error(`The narration of ${stale.join(", ")} doesn't match narration/lines.ts; run bun run narrate`);
  const placed = placeScenes(STORYBOARD, clips, narration, FRAME.fps, CROSSFADE_FRAMES);
  const last = placed.at(-1)!;
  return { durationInFrames: last.from + last.frames, props: { placed, clips, narration } };
};

export function Root() {
  return (
    <Composition
      id="Trailer"
      component={Trailer}
      width={FRAME.width}
      height={FRAME.height}
      fps={FRAME.fps}
      durationInFrames={FRAME.fps}
      defaultProps={{ placed: [], clips: {}, narration: {} }}
      calculateMetadata={calculateMetadata}
    />
  );
}
