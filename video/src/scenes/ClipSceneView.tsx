import type { ReactNode } from "react";
import { AbsoluteFill, Freeze, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { FRAME, WINDOW } from "../brand.ts";
import { cameraTransform, viewAt } from "../camera.ts";
import { AppWindow, ClipVideo } from "../components/AppWindow.tsx";
import { Backdrop } from "../components/Backdrop.tsx";
import { CaptionCard } from "../components/CaptionCard.tsx";
import type { ClipInfo, ClipScene } from "../timeline.ts";
import { shotsOf, shotTrim } from "../timeline.ts";

/** A filmed scene: the clip's shots in the app window, the camera moving between its views, and the scene's captions. */
export function ClipSceneView({ scene, clip, frames }: { scene: ClipScene; clip: ClipInfo; frames: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const src = staticFile(`clips/${clip.name}.mp4`);
  const shots = shotsOf(scene, clip);
  const footageEnds = Math.round(shots.at(-1)!.sceneTo * fps);
  const last = shots.at(-1)!;
  const camera = cameraTransform(viewAt(scene, clip, frame / fps), WINDOW.app, FRAME);
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={camera}>
        <AppWindow>
          {shots.map((shot, index) => {
            const from = Math.round(shot.sceneFrom * fps);
            const fadeInFrames = index > 0 ? (scene.shots[index]!.fadeInFrames ?? 0) : 0;
            return (
              <Sequence key={from} from={from} durationInFrames={Math.round(shot.sceneTo * fps) - from} layout="none">
                <ClipVideo src={src} {...shotTrim(shot, clip, fps)} playbackRate={shot.speed} />
                {fadeInFrames > 0 && (
                  <Sequence durationInFrames={fadeInFrames} layout="none">
                    <FadingOut frames={fadeInFrames}>
                      <ClipFrame src={src} at={shots[index - 1]!.clipTo} />
                    </FadingOut>
                  </Sequence>
                )}
              </Sequence>
            );
          })}
          {frames > footageEnds && (
            <Sequence from={footageEnds} layout="none">
              <ClipFrame src={src} at={last.clipTo} />
            </Sequence>
          )}
        </AppWindow>
      </AbsoluteFill>
      {(scene.captions ?? []).map((caption) => (
        <CaptionCard key={caption.title} kicker={caption.kicker} title={caption.title} side={caption.side} from={Math.round((caption.at ?? 0.5) * fps)} to={caption.seconds ? Math.round(((caption.at ?? 0.5) + caption.seconds) * fps) : frames - 12} />
      ))}
    </AbsoluteFill>
  );
}

/** The clip's frame just before `at` seconds, held still. */
function ClipFrame({ src, at }: { src: string; at: number }) {
  const { fps } = useVideoConfig();
  const frame = Math.round(at * fps);
  return (
    <Freeze frame={0}>
      <ClipVideo src={src} trimBefore={frame - 1} trimAfter={frame} playbackRate={1} />
    </Freeze>
  );
}

/** Its children, fading from full to clear over `frames` frames. */
function FadingOut({ frames, children }: { frames: number; children: ReactNode }) {
  const opacity = interpolate(useCurrentFrame(), [0, frames], [1, 0], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}
