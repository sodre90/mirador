import { describe, expect, test } from "bun:test";
import { isFromAnotherSite, siteOf } from "../web/external-images.ts";

describe("external image checks", () => {
  test("flag cross-origin http(s) URLs on normal origins and keep same-origin, relative, and data URLs", () => {
    expect(isFromAnotherSite("https://example.com/pic.png", "http://127.0.0.1:4600")).toBe(true);
    expect(siteOf("https://example.com/pic.png", "http://127.0.0.1:4600")).toBe("example.com");
    expect(isFromAnotherSite("http://127.0.0.1:4600/pic.png", "http://127.0.0.1:4600")).toBe(false);
    expect(isFromAnotherSite("/pic.png", "http://127.0.0.1:4600")).toBe(false);
    expect(isFromAnotherSite("data:image/png;base64,AA==", "http://127.0.0.1:4600")).toBe(false);
  });

  test("flag cross-site http(s) URLs inside opaque-origin invited-room frames where location.origin is 'null'", () => {
    expect(isFromAnotherSite("https://example.com/pic.png", "null")).toBe(true);
    expect(siteOf("https://example.com/pic.png", "null")).toBe("example.com");
    expect(isFromAnotherSite("/local.png", "null")).toBe(false);
    expect(isFromAnotherSite("data:image/png;base64,AA==", "null")).toBe(false);
  });
});
