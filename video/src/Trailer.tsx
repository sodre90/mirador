import { Audio } from "@remotion/media";
import { AbsoluteFill, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "./components/Backdrop.tsx";
import { musicVolume, spokenSpans } from "./mix.ts";
import { ClipSceneView } from "./scenes/ClipSceneView.tsx";
import { EndScene } from "./scenes/EndScene.tsx";
import { LogoScene } from "./scenes/LogoScene.tsx";
import { TextWallScene } from "./scenes/TextWallScene.tsx";
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

function SceneView({ scene, clips, frames }: { scene: Scene; clips: Record<string, ClipInfo>; frames: number }) {
  if (scene.kind === "clip") return <ClipSceneView scene={scene} clip={clips[scene.clip]!} frames={frames} />;
  if (scene.kind === "text-wall") return <TextWallScene scene={scene} />;
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
