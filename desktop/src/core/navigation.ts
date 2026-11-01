/** Everything outside the app's own origins is blocked in the window; the page asks the app to open a link in the browser. */
export const navigationRules = (allowedOrigins: string[]) => ["^*", ...allowedOrigins.map((origin) => `${origin}/*`), "about:*"];

export function webUrl(text: unknown) {
  try {
    const url = new URL(String(text));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
