import { Audio } from "@remotion/media";
import { AbsoluteFill, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "./components/Backdrop.tsx";
import { ChapterRail } from "./components/ChapterRail.tsx";
import { Flash, punchScale, shake } from "./components/Hit.tsx";
import { musicVolume, spokenSpans } from "./mix.ts";
import { CheckoutPicture } from "./scenes/CheckoutPicture.tsx";
import { ClipSceneView } from "./scenes/ClipSceneView.tsx";
import { EndScene } from "./scenes/EndScene.tsx";
import { WallOfText } from "./scenes/WallOfText.tsx";
import { BRAND } from "./brand.ts";
import { MUSIC, WEBSITE, WHERE_TO_GET_IT } from "./storyboard.ts";
import type { ClipInfo, NarrationLine, PlacedScene, Scene } from "./timeline.ts";

export type TrailerProps = {
  placed: PlacedScene[];
  clips: Record<string, ClipInfo>;
  narration: Record<string, NarrationLine>;
};

/** A scene that fades in over the one before it, or cuts straight to it. */
function FadeIn({ children, frames }: { children: React.ReactNode; frames: number }) {
  const frame = useCurrentFrame();
  const opacity = frames === 0 ? 1 : interpolate(frame, [0, frames], [0, 1], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

/** When the hook flips from the wall of text to the live checkout diagram (in seconds of the 8s hook scene). */
export const CANVAS_AT = 3.2;

function DrawingPicture() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const flipFrame = Math.round(CANVAS_AT * fps);
  const { x, y } = shake(frame, flipFrame, 18);
  const punch = punchScale(frame, flipFrame, 0.06);
  return (
    <AbsoluteFill style={{ transform: `translate(${x}px, ${y}px) scale(${punch})` }}>
      {seconds < CANVAS_AT ? <WallOfText seconds={seconds} until={CANVAS_AT} /> : <CheckoutPicture secondsIn={seconds - CANVAS_AT} />}
      <Flash from={flipFrame} frames={12} strength={0.34} color={BRAND.violet} />
    </AbsoluteFill>
  );
}

function SceneView({ scene, clips, frames }: { scene: Scene; clips: Record<string, ClipInfo>; frames: number }) {
  if (scene.kind === "clip") return <ClipSceneView scene={scene} clip={clips[scene.clip]!} frames={frames} />;
  if (scene.kind === "picture") return <DrawingPicture />;
  if (scene.kind === "backdrop") return <Backdrop accent={scene.accent} />;
  return <EndScene frames={frames} url={WHERE_TO_GET_IT} website={WEBSITE} />;
}

export function Trailer({ placed, clips, narration }: TrailerProps) {
  const { fps } = useVideoConfig();
  const spoken = spokenSpans(placed, narration, fps);
  return (
    <AbsoluteFill style={{ background: BRAND.night }}>
      {placed.map(({ scene, from, frames, fadeInFrames }) => (
        <Sequence key={scene.id} from={from} durationInFrames={frames} name={scene.id}>
          <FadeIn frames={fadeInFrames}>
            <SceneView scene={scene} clips={clips} frames={frames} />
          </FadeIn>
        </Sequence>
      ))}
      <ChapterRail placed={placed} />
      <Audio src={staticFile(MUSIC)} volume={(frame) => musicVolume(frame, spoken, fps)} />
      {placed.flatMap(({ from, lines }) =>
        lines.map(({ line, at }) => (
          <Sequence key={`narration ${line}`} from={from + Math.round(at * fps)} name={`narration: ${line}`}>
            <Audio src={staticFile(`narration/${narration[line]!.file}`)} />
          </Sequence>
        )),
      )}
    </AbsoluteFill>
  );
}
