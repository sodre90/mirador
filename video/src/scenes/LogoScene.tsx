import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND, FONT } from "../brand.ts";
import { AppIcon } from "../components/AppIcon.tsx";
import { Backdrop } from "../components/Backdrop.tsx";
import { Reveal } from "../components/Reveal.tsx";

/** The answer to the wall of text: the icon builds itself, the name slides out from behind it, and the promise follows. */
export function LogoScene({ frames }: { frames: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const name = spring({ frame: frame - 22, fps, config: { damping: 200, mass: 0.9 } });
  const settle = interpolate(frame, [0, frames], [1.04, 1]);
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${settle})` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 90 }}>
          <AppIcon size={520} />
          <div style={{ overflow: "hidden", paddingRight: 20 }}>
            <div style={{ font: `780 300px ${FONT}`, letterSpacing: "-0.04em", color: BRAND.ink, transform: `translateX(${(1 - name) * -110}%)`, opacity: name }}>Mirador</div>
          </div>
        </div>
        <Reveal at={44} style={{ marginTop: 70 }}>
          <div style={{ font: `500 92px ${FONT}`, color: BRAND.muted, letterSpacing: "-0.01em" }}>
            A <span style={{ color: BRAND.ink, fontWeight: 700 }}>canvas</span> for your coding agent.
          </div>
        </Reveal>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
