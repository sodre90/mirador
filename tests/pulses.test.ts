import { describe, expect, test } from "bun:test";
import { pulseStyleFor } from "../web/pulses.ts";

const userAgents = {
  linuxDesktopApp: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  linuxChrome: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
};

describe("pulseStyleFor", () => {
  test("steps the pulses on Linux desktops, where every animation frame costs the window CPU", () => {
    expect(pulseStyleFor(true, userAgents.linuxDesktopApp)).toBe("stepped");
    expect(pulseStyleFor(true, userAgents.linuxChrome)).toBe("stepped");
  });

  test("keeps them smooth where the system compositor runs them", () => {
    expect(pulseStyleFor(true, userAgents.mac)).toBe("smooth");
    expect(pulseStyleFor(true, userAgents.windows)).toBe("smooth");
    expect(pulseStyleFor(true, userAgents.android)).toBe("smooth");
  });

  test("stops them everywhere once they are turned off", () => {
    expect(Object.values(userAgents).map((userAgent) => pulseStyleFor(false, userAgent))).toEqual(Array(5).fill("off"));
  });
});
