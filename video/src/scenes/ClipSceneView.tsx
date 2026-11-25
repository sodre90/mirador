import type { ReactNode } from "react";
import { AbsoluteFill, Freeze, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND, FRAME, WINDOW } from "../brand.ts";
import { cameraTransform, viewAt } from "../camera.ts";
import { AppWindow, ClipVideo } from "../components/AppWindow.tsx";
import { Backdrop } from "../components/Backdrop.tsx";
import { CaptionCard } from "../components/CaptionCard.tsx";
import { entrance3d, Flash } from "../components/Hit.tsx";
import type { ClipInfo, ClipScene } from "../timeline.ts";
import { shotsOf, shotTrim } from "../timeline.ts";

/** A filmed chapter: the clip's shots inside the sleek 0.15.5 window, smooth 3D settle, camera moves, and top chapter bar. */
export function ClipSceneView({ scene, clip, frames }: { scene: ClipScene; clip: ClipInfo; frames: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const src = staticFile(`clips/${clip.name}.mp4`);
  const shots = shotsOf(scene, clip);
  const footageEnds = Math.round(shots.at(-1)!.sceneTo * fps);
  const last = shots.at(-1)!;
  const camera = cameraTransform(viewAt(scene, clip, frame / fps), WINDOW.app, { ...FRAME, topInset: 168 });
  const accent = scene.accent ?? BRAND.violet;
  return (
    <AbsoluteFill>
      <Backdrop accent={accent} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: "inset(166px 0px 10px 0px)",
        }}
      >
        <AbsoluteFill style={scene.slam ? { transform: entrance3d(frame, fps, scene.tilt ?? 1) } : undefined}>
          <AbsoluteFill style={camera}>
            <AppWindow accent={accent}>
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
        </AbsoluteFill>
      </div>
      {scene.slam && <Flash color={accent} />}
      {(scene.captions ?? []).map((caption) => (
        <CaptionCard
          key={caption.title}
          kicker={caption.kicker}
          title={caption.title}
          position={caption.position}
          accent={caption.accent ?? accent}
          from={Math.round((caption.at ?? 0.2) * fps)}
          to={caption.seconds ? Math.round(((caption.at ?? 0.2) + caption.seconds) * fps) : frames - 10}
        />
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
      <ClipVideo src={src} trimBefore={Math.max(0, frame - 1)} trimAfter={Math.max(1, frame)} playbackRate={1} />
    </Freeze>
  );
}

/** Its children, fading from full to clear over `frames` frames. */
function FadingOut({ frames, children }: { frames: number; children: ReactNode }) {
  const opacity = interpolate(useCurrentFrame(), [0, frames], [1, 0], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}
