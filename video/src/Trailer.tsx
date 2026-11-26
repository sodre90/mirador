import { Audio } from "@remotion/media";
import { AbsoluteFill, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "./components/Backdrop.tsx";
import { ChapterRail } from "./components/ChapterRail.tsx";
import { ChapterCaptions } from "./components/CaptionCard.tsx";
import { entrance3d, Flash, punchScale, shake } from "./components/Hit.tsx";
import { musicVolume, spokenSpans } from "./mix.ts";
import { CarModePicture } from "./scenes/CarModePicture.tsx";
import { ClipSceneView } from "./scenes/ClipSceneView.tsx";
import { EndScene } from "./scenes/EndScene.tsx";
import { PeerToPeerPicture } from "./scenes/PeerToPeerPicture.tsx";
import { WallOfText } from "./scenes/WallOfText.tsx";
import { BRAND } from "./brand.ts";
import { MUSIC, WEBSITE, WHERE_TO_GET_IT } from "./storyboard.ts";
import type { CardScene, ClipInfo, NarrationLine, PlacedScene, Scene } from "./timeline.ts";

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

/** When the hook flips from the wall of text to the agent asking about car mode on iPhones (in seconds of the 8s hook scene). */
export const CANVAS_AT = 3.0;

function DrawingPicture() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const flipFrame = Math.round(CANVAS_AT * fps);
  const { x, y } = shake(frame, flipFrame, 18);
  const punch = punchScale(frame, flipFrame, 0.06);
  return (
    <AbsoluteFill style={{ transform: `translate(${x}px, ${y}px) scale(${punch})` }}>
      {seconds < CANVAS_AT ? <WallOfText seconds={seconds} until={CANVAS_AT} /> : <CarModePicture secondsIn={seconds - CANVAS_AT} />}
      <Flash from={flipFrame} frames={12} strength={0.34} color={BRAND.violet} />
    </AbsoluteFill>
  );
}

/** What each picture scene draws, by its id. */
const PICTURES: Record<string, () => React.ReactNode> = { hook: DrawingPicture, p2p: PeerToPeerPicture };

/** A picture, or a drawn chapter: one with captions comes in like a filmed chapter, over its backdrop under its chapter bar. */
function PictureView({ scene, frames }: { scene: CardScene; frames: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const Picture = PICTURES[scene.id];
  if (!Picture) throw new Error(`No picture is drawn for the scene "${scene.id}"; there are ${Object.keys(PICTURES).join(", ")}`);
  if (!scene.captions) return <Picture />;
  const accent = scene.accent ?? BRAND.violet;
  return (
    <AbsoluteFill>
      <Backdrop accent={accent} />
      <AbsoluteFill style={scene.slam ? { transform: entrance3d(frame, fps, scene.tilt ?? 1) } : undefined}>
        <Picture />
      </AbsoluteFill>
      {scene.slam && <Flash color={accent} />}
      <ChapterCaptions captions={scene.captions} accent={accent} frames={frames} />
    </AbsoluteFill>
  );
}

function SceneView({ scene, clips, frames }: { scene: Scene; clips: Record<string, ClipInfo>; frames: number }) {
  if (scene.kind === "clip") return <ClipSceneView scene={scene} clip={clips[scene.clip]!} frames={frames} />;
  if (scene.kind === "picture") return <PictureView scene={scene} frames={frames} />;
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
