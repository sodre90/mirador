import { Video } from "@remotion/media";
import type { CSSProperties, ReactNode } from "react";
import { BRAND, FONT, WINDOW } from "../brand.ts";

/** A sleek desktop window around the app: specular accent rim, macOS traffic lights, title bar, and deep shadow. */
export function AppWindow({ children, style, accent = BRAND.violet, title = "Mirador" }: { children: ReactNode; style?: CSSProperties; accent?: string; title?: string }) {
  const { box, titleBar, radius } = WINDOW;
  return (
    <div
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        borderRadius: radius,
        overflow: "hidden",
        background: "#12111d",
        boxShadow: `0 70px 180px rgba(0, 0, 0, 0.68), 0 0 110px ${accent}24, 0 0 0 2px rgba(255, 255, 255, 0.11)`,
        ...style,
      }}
    >
      <div
        style={{
          height: titleBar,
          display: "flex",
          alignItems: "center",
          position: "relative",
          background: "linear-gradient(180deg, #211f30 0%, #191826 100%)",
          borderBottom: "2px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: "18%",
            right: "18%",
            height: 2,
            background: `linear-gradient(90deg, transparent, ${accent}cc, transparent)`,
          }}
        />
        <div style={{ display: "flex", gap: 18, marginLeft: 28 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((colour) => (
            <span key={colour} style={{ width: 20, height: 20, borderRadius: 10, background: colour, boxShadow: "inset 0 -1px 2px rgba(0,0,0,0.3)" }} />
          ))}
        </div>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 14, color: BRAND.muted, font: `600 24px ${FONT}`, letterSpacing: "0.01em" }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: accent, boxShadow: `0 0 12px ${accent}` }} />
          {title}
        </div>
      </div>
      <div style={{ position: "relative", width: box.width, height: box.height - titleBar }}>{children}</div>
    </div>
  );
}

/** A stretch of a filmed clip, filling the window's app area. */
export function ClipVideo({ src, trimBefore, trimAfter, playbackRate }: { src: string; trimBefore: number; trimAfter: number; playbackRate: number }) {
  return <Video src={src} trimBefore={trimBefore} trimAfter={trimAfter} playbackRate={playbackRate} muted style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}
