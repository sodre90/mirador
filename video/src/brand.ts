/** The app icon's colours, from desktop/assets/app-icon.svg, plus per-chapter accents. */
export const BRAND = {
  violet: "#7676f2",
  indigo: "#3836a3",
  coral: "#ff8a6b",
  night: "#090812",
  ink: "#f5f4ff",
  muted: "#a9a6c9",
} as const;

/** Per-chapter accent colours for the ambient backdrop, window rim, and chapter bar. */
export const ACCENTS = {
  violet: "#8b7cf6",
  sky: "#58b4ff",
  coral: "#ff7e67",
  emerald: "#34d399",
  amber: "#fbbf24",
  pink: "#ec6ea8",
  cyan: "#38d9e8",
} as const;

export const FONT = '"Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, sans-serif';
export const MONO = '"JetBrains Mono", "SF Mono", Menlo, monospace';

/** The frame, and where the app window rests in it when the camera frames the whole app. */
export const FRAME = { width: 3840, height: 2160, fps: 60 };
/** How long one scene fades into the next when it does not cut straight in. */
export const CROSSFADE_FRAMES = 14;
const TITLE_BAR = 56;
const APP_WIDTH = 3300;
const APP_HEIGHT = (APP_WIDTH * 864) / 1536;
/** Leaves a clean 194 px header band above the window so the floating chapter bar never covers the app. */
const WINDOW_TOP = 194;
export const WINDOW = {
  titleBar: TITLE_BAR,
  box: { x: (FRAME.width - APP_WIDTH) / 2, y: WINDOW_TOP, width: APP_WIDTH, height: APP_HEIGHT + TITLE_BAR },
  app: { x: (FRAME.width - APP_WIDTH) / 2, y: WINDOW_TOP + TITLE_BAR, width: APP_WIDTH, height: APP_HEIGHT },
  radius: 28,
};
