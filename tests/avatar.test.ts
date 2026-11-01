import { describe, expect, test } from "bun:test";
import { avatarProblem, AVATAR_PIXELS, MAX_AVATAR_BYTES } from "../shared/avatar.ts";

/** The bytes of a PNG wide and tall as given, with `filler` bytes standing where the pixels would be. */
function png(width: number, height: number, filler = 0) {
  const bytes = new Uint8Array(24 + filler);
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((byte, index) => (bytes[index] = byte));
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const dataUrl = (bytes: Uint8Array) => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;

describe("avatarProblem", () => {
  test("takes the square PNG data URL a page draws", () => {
    expect(avatarProblem(dataUrl(png(AVATAR_PIXELS, AVATAR_PIXELS, 2_000)))).toBeNull();
  });

  test("refuses a data URL of another kind of image", () => {
    expect(avatarProblem("data:image/jpeg;base64,abg2DAE=")).toContain("PNG");
    expect(avatarProblem("not a data url at all")).not.toBeNull();
  });

  test("refuses base64 that is not base64, or too short to hold a header", () => {
    expect(avatarProblem("data:image/png;base64,!!!!")).not.toBeNull();
    expect(avatarProblem("data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e]).toString("base64"))).not.toBeNull();
  });

  test("refuses bytes that are not a PNG file", () => {
    const notPng = png(8, 8);
    notPng[1] = 0x00;
    expect(avatarProblem(dataUrl(notPng))).not.toBeNull();
    const wrongChunk = png(8, 8);
    wrongChunk[12] = 0x00;
    expect(avatarProblem(dataUrl(wrongChunk))).not.toBeNull();
  });

  test("refuses a picture that is not a square, or wider than the host takes", () => {
    expect(avatarProblem(dataUrl(png(40, 30)))).toContain("square");
    expect(avatarProblem(dataUrl(png(256, 256)))).toBeNull();
    expect(avatarProblem(dataUrl(png(257, 257)))).not.toBeNull();
  });

  test("refuses a picture heavier than the host stores", () => {
    expect(avatarProblem(dataUrl(png(128, 128, MAX_AVATAR_BYTES)))).not.toBeNull();
    expect(avatarProblem(dataUrl(png(128, 128, MAX_AVATAR_BYTES - 24)))).toBeNull();
  });
});
