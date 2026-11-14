import { useState, type CSSProperties } from "react";

const MONOGRAM_HUES = [262, 145, 220, 355, 30, 190, 300, 95];

const hueOf = (key: string) => MONOGRAM_HUES[[...key].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0) % MONOGRAM_HUES.length]!;

const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** The plugin's own icon, drawn as an image so its SVG runs no script; its monogram while it has none or the icon fails. */
export function PluginIcon({ name, title, icon }: { name: string; title: string; icon: string | null | undefined }) {
  const [failed, setFailed] = useState(false);
  if (icon && !failed) return <img className="plugin-icon" src={svgDataUrl(icon)} alt="" onError={() => setFailed(true)} />;
  return (
    <span className="plugin-monogram" aria-hidden style={{ "--monogram-hue": hueOf(name) } as CSSProperties}>
      {title.trim().charAt(0).toUpperCase()}
    </span>
  );
}
