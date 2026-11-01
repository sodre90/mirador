import { expect, test } from "bun:test";
import { homebrewCask } from "../desktop/scripts/homebrew-cask.ts";

const checksums = { macosArm64: "a".repeat(64), linuxX64: "b".repeat(64), linuxArm64: "c".repeat(64) };
const cask = homebrewCask("1.2.3", checksums);

test("the cask names the release's version and each download's checksum for its platform", () => {
  expect(cask).toContain('version "1.2.3"');
  expect(cask).toContain(`sha256 arm:          "${checksums.macosArm64}"`);
  expect(cask).toContain(`arm64_linux:  "${checksums.linuxArm64}"`);
  expect(cask).toContain(`x86_64_linux: "${checksums.linuxX64}"`);
});

test("the cask downloads the release's assets, with Homebrew filling in the version and the Linux architecture", () => {
  expect(cask).toContain('url "https://github.com/sodre90/mirador/releases/download/v#{version}/Mirador-macos-arm64.zip"');
  expect(cask).toContain('url "https://github.com/sodre90/mirador/releases/download/v#{version}/Mirador-linux-#{arch}-Setup.tar.gz"');
  expect(cask).toContain('arch arm: "arm64", intel: "x64"');
});

test("neither uninstall nor zap touches the conversations in ~/.mirador", () => {
  expect(cask).not.toContain("~/.mirador");
});

test("the cask's homepage is Mirador's website", () => {
  expect(cask).toContain('homepage "https://mirador.sodre90.com/"');
});
