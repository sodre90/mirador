import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ACCENTS, BRAND, FONT, MONO } from "../brand.ts";
import { AppIcon } from "../components/AppIcon.tsx";
import { Backdrop } from "../components/Backdrop.tsx";
import { Reveal } from "../components/Reveal.tsx";

const AGENTS = [
  { name: "Claude Code", color: "#ff8a6b" },
  { name: "opencode", color: "#58b4ff" },
  { name: "pi", color: "#34d399" },
  { name: "Codex", color: "#a78bfa" },
  { name: "Copilot", color: "#38d9e8" },
  { name: "Antigravity", color: "#fbbf24" },
];

const INSTALL_CMD = "curl -fsSL https://github.com/sodre90/mirador/releases/latest/download/install.sh | sh";

/**
 * The closing brand card: Mirador 0.15.5, tagline, all six supported agents, one-line install command, platforms, and
 * website + GitHub links.
 */
export function EndScene({ frames, url, website }: { frames: number; url: string; website: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeOut = interpolate(frame, [frames - 30, frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const landed = spring({ frame, fps, config: { damping: 16, mass: 0.7 } });

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <Backdrop accent={BRAND.violet} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
        <div style={{ display: "flex", alignItems: "center", gap: 54, transform: `scale(${1.12 - 0.12 * landed})` }}>
          <AppIcon size={250} />
          <div style={{ display: "flex", alignItems: "baseline", gap: 36 }}>
            <div style={{ font: `800 184px ${FONT}`, letterSpacing: "-0.04em", color: BRAND.ink }}>Mirador</div>
            <div
              style={{
                padding: "12px 30px",
                borderRadius: 999,
                background: `${ACCENTS.violet}24`,
                border: `2px solid ${ACCENTS.violet}88`,
                font: `700 44px ${MONO}`,
                color: "#c8c2ff",
              }}
            >
              0.15.5
            </div>
          </div>
        </div>

        <Reveal at={42} style={{ marginTop: 64 }}>
          <div style={{ fontSize: 112, fontWeight: 740, letterSpacing: "-0.03em", color: BRAND.ink }}>
            See what your coding agent{" "}
            <span style={{ background: `linear-gradient(90deg, ${BRAND.violet}, ${BRAND.coral})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>means.</span>
          </div>
        </Reveal>

        <div style={{ display: "flex", gap: 24, marginTop: 66 }}>
          {AGENTS.map(({ name, color }, index) => {
            const pop = spring({ frame: frame - 105 - index * 6, fps, config: { damping: 17, mass: 0.6 } });
            return (
              <div
                key={name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "18px 36px",
                  borderRadius: 999,
                  background: "rgba(255, 255, 255, 0.06)",
                  border: "2px solid rgba(255, 255, 255, 0.14)",
                  font: `600 44px ${FONT}`,
                  color: BRAND.ink,
                  opacity: Math.min(1, pop * 1.4),
                  transform: `translateY(${(1 - pop) * 28}px)`,
                }}
              >
                <span style={{ width: 15, height: 15, borderRadius: 8, background: color, boxShadow: `0 0 14px ${color}` }} />
                {name}
              </div>
            );
          })}
        </div>

        <Reveal at={175} style={{ marginTop: 64 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
              padding: "30px 58px",
              borderRadius: 24,
              border: `2px solid ${BRAND.violet}99`,
              background: "rgba(18, 16, 38, 0.88)",
              boxShadow: `0 24px 70px rgba(0, 0, 0, 0.55), 0 0 60px ${BRAND.violet}28`,
              font: `500 42px ${MONO}`,
              color: BRAND.ink,
            }}
          >
            <span style={{ color: BRAND.coral, fontWeight: 700 }}>$</span>
            <span>{INSTALL_CMD}</span>
          </div>
        </Reveal>

        <Reveal at={230} style={{ marginTop: 54 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 38, font: `600 48px ${FONT}`, color: "#d6d4ee" }}>
            <span>macOS · Linux · Windows · Mobile</span>
            <span style={{ opacity: 0.35 }}>|</span>
            <span style={{ fontFamily: MONO, color: BRAND.ink }}>{website}</span>
            <span style={{ opacity: 0.35 }}>|</span>
            <span style={{ fontFamily: MONO, color: "#b8b4e6" }}>{url}</span>
          </div>
        </Reveal>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "#fff", opacity: interpolate(frame, [0, 12], [0.22, 0], { extrapolateRight: "clamp" }), pointerEvents: "none" }} />
    </AbsoluteFill>
  );
}
