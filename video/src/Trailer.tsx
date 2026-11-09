import { Audio } from "@remotion/media";
import { AbsoluteFill, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "./components/Backdrop.tsx";
import { musicVolume, spokenSpans } from "./mix.ts";
import { ClipSceneView } from "./scenes/ClipSceneView.tsx";
import { EndScene } from "./scenes/EndScene.tsx";
import { LogoScene } from "./scenes/LogoScene.tsx";
import { CheckoutPicture } from "./scenes/CheckoutPicture.tsx";
import { WallOfText } from "./scenes/WallOfText.tsx";
import { Flash, punchScale, shake } from "./components/Hit.tsx";
import { MUSIC, PLUGIN_CATALOG, WHERE_TO_GET_IT } from "./storyboard.ts";
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

/** When the hook cuts from the wall of text to the diagram, as the narrator turns to the canvas, in seconds of the scene. */
const CANVAS_AT = 3.5;
/** The hook's two hits: on the wall, and on the cut to the diagram. */
const HITS_AT = [0, CANVAS_AT];

function DrawingPicture() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const hits = HITS_AT.map((at) => Math.round(at * fps));
  const { x, y } = hits.map((hit) => shake(frame, hit)).reduce((sum, offset) => ({ x: sum.x + offset.x, y: sum.y + offset.y }));
  const punch = Math.max(...hits.map((hit) => punchScale(frame, hit, 0.08)));
  return (
    <AbsoluteFill style={{ transform: `translate(${x}px, ${y}px) scale(${punch})` }}>
      {seconds < CANVAS_AT ? <WallOfText seconds={seconds} until={CANVAS_AT} /> : <CheckoutPicture secondsIn={seconds - CANVAS_AT} />}
      {hits.map((hit) => (
        <Flash key={hit} from={hit} />
      ))}
    </AbsoluteFill>
  );
}

function SceneView({ scene, clips, frames }: { scene: Scene; clips: Record<string, ClipInfo>; frames: number }) {
  if (scene.kind === "clip") return <ClipSceneView scene={scene} clip={clips[scene.clip]!} frames={frames} />;
  if (scene.kind === "picture") return <DrawingPicture />;
  if (scene.kind === "logo") return <LogoScene frames={frames} />;
  if (scene.kind === "backdrop") return <Backdrop />;
  return <EndScene frames={frames} url={WHERE_TO_GET_IT} pluginCatalog={PLUGIN_CATALOG} />;
}

export function Trailer({ placed, clips, narration }: TrailerProps) {
  const { fps } = useVideoConfig();
  const spoken = spokenSpans(placed, narration, fps);
  return (
    <AbsoluteFill style={{ background: "#08070f" }}>
      {placed.map(({ scene, from, frames, fadeInFrames }) => (
        <Sequence key={scene.id} from={from} durationInFrames={frames} name={scene.id}>
          <FadeIn frames={fadeInFrames}>
            <SceneView scene={scene} clips={clips} frames={frames} />
          </FadeIn>
        </Sequence>
      ))}
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
