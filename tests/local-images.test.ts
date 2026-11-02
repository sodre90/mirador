import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageTypeOf, localImage } from "../host/local-images.ts";
import { isLocalImagePath, localImageUrl } from "../shared/images.ts";

const folder = mkdtempSync(join(tmpdir(), "local-images-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((part) => (typeof part === "string" ? [...part].map((character) => character.charCodeAt(0)) : part)));

describe("imageTypeOf", () => {
  test("knows PNG, JPEG, GIF and WebP by their first bytes", () => {
    expect(imageTypeOf(bytes([0x89], "PNG\r\n", [0x1a, 0x0a]))).toBe("image/png");
    expect(imageTypeOf(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(imageTypeOf(bytes("GIF89a"))).toBe("image/gif");
    expect(imageTypeOf(bytes("RIFF", [0, 0, 0, 0], "WEBP"))).toBe("image/webp");
  });

  test("takes nothing else for an image, SVG included", () => {
    expect(imageTypeOf(bytes("TOKEN=secret"))).toBeNull();
    expect(imageTypeOf(bytes("<svg xmlns"))).toBeNull();
    expect(imageTypeOf(bytes("RIFF", [0, 0, 0, 0], "WAVE"))).toBeNull();
  });
});

describe("localImage", () => {
  test("serves an image file by an absolute path, whatever its name", async () => {
    const path = join(folder, "shot.txt");
    writeFileSync(path, bytes([0x89], "PNG\r\n", [0x1a, 0x0a], [0, 0, 0, 0]));
    expect((await localImage(path))?.mimeType).toBe("image/png");
  });

  test("refuses relative paths, folders, missing files and files that are not images", async () => {
    const text = join(folder, "secret.png");
    writeFileSync(text, "TOKEN=secret");
    expect(await localImage(text)).toBeNull();
    expect(await localImage(folder)).toBeNull();
    expect(await localImage(join(folder, "missing.png"))).toBeNull();
    expect(await localImage("shot.png")).toBeNull();
  });
});

describe("isLocalImagePath", () => {
  test("takes absolute paths on macOS, Linux and Windows", () => {
    expect(isLocalImagePath("/Users/me/shot.png")).toBe(true);
    expect(isLocalImagePath("C:\\Users\\me\\shot.png")).toBe(true);
    expect(isLocalImagePath("d:/shots/shot.png")).toBe(true);
  });

  test("takes a Windows path as Markdown hands it over, its backslashes percent-encoded", () => {
    expect(isLocalImagePath("C:%5CUsers%5Cme%5CK%C3%A9perny%C5%91k%C3%A9p%201.png")).toBe(true);
    expect(localImageUrl("c1", "C:%5CUsers%5Cme%5Cshot.png")).toBe(`/conversations/c1/local-image?path=${encodeURIComponent("C:\\Users\\me\\shot.png")}`);
  });

  test("takes no address on another site, relative path or other protocol", () => {
    expect(isLocalImagePath("//example.com/shot.png")).toBe(false);
    expect(isLocalImagePath("https://example.com/shot.png")).toBe(false);
    expect(isLocalImagePath("shots/shot.png")).toBe(false);
    expect(isLocalImagePath("javascript:alert(1)")).toBe(false);
    expect(isLocalImagePath("C:shot.png")).toBe(false);
  });
});
