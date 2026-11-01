/** The app icon's colours, from desktop/assets/app-icon.svg. */
export const BRAND = {
  violet: "#7676f2",
  indigo: "#3836a3",
  coral: "#ff8a6b",
  night: "#0c0b16",
  ink: "#f4f3ff",
  muted: "#a9a6c9",
};

export const FONT = '"Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, sans-serif';
export const MONO = '"JetBrains Mono", "SF Mono", Menlo, monospace';

/** The frame, and where the app window rests in it when the camera frames the whole app. */
export const FRAME = { width: 3840, height: 2160, fps: 60 };
/** How long one scene fades into the next. */
export const CROSSFADE_FRAMES = 18;
const TITLE_BAR = 64;
const APP_WIDTH = 3260;
const APP_HEIGHT = (APP_WIDTH * 864) / 1536;
const WINDOW_TOP = Math.round((FRAME.height - APP_HEIGHT - TITLE_BAR) / 2) + 18;
export const WINDOW = {
  titleBar: TITLE_BAR,
  box: { x: (FRAME.width - APP_WIDTH) / 2, y: WINDOW_TOP, width: APP_WIDTH, height: APP_HEIGHT + TITLE_BAR },
  app: { x: (FRAME.width - APP_WIDTH) / 2, y: WINDOW_TOP + TITLE_BAR, width: APP_WIDTH, height: APP_HEIGHT },
  radius: 30,
};
