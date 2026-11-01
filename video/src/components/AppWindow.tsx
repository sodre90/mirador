import { Video } from "@remotion/media";
import type { CSSProperties, ReactNode } from "react";
import { BRAND, FONT, WINDOW } from "../brand.ts";

/** A desktop window around the app: a dark title bar with the three lights and Mirador's name, and a soft shadow. */
export function AppWindow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
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
        background: "#141320",
        boxShadow: "0 60px 160px rgba(0, 0, 0, 0.55), 0 0 0 2px rgba(255, 255, 255, 0.07)",
        ...style,
      }}
    >
      <div style={{ height: titleBar, display: "flex", alignItems: "center", position: "relative", background: "linear-gradient(#22202f, #1b1a27)", borderBottom: "2px solid #2c2a3d" }}>
        <div style={{ display: "flex", gap: 20, marginLeft: 30 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((colour) => (
            <span key={colour} style={{ width: 24, height: 24, borderRadius: 12, background: colour }} />
          ))}
        </div>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 16, color: BRAND.muted, font: `600 26px ${FONT}` }}>
          Mirador
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
