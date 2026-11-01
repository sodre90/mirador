#!/usr/bin/env bun
/**
 * Writes dist/mirador.rb, the Homebrew cask of this release, for the sodre90/homebrew-tap tap:
 * `brew install --cask sodre90/tap/mirador` on macOS (Apple Silicon) and Linux (x64, arm64).
 * Usage: homebrew-cask.ts <dist>, after the release's final macOS zip and Linux installers are in dist/.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RELEASES_REPOSITORY } from "../../shared/newer-version.ts";
import { MIRADOR_VERSION } from "../../shared/version.ts";

export const CASK_ASSETS = {
  macosArm64: "Mirador-macos-arm64.zip",
  linuxX64: "Mirador-linux-x64-Setup.tar.gz",
  linuxArm64: "Mirador-linux-arm64-Setup.tar.gz",
} as const;

export type CaskChecksums = Record<keyof typeof CASK_ASSETS, string>;

export function homebrewCask(version: string, sha256: CaskChecksums) {
  const download = `https://github.com/${RELEASES_REPOSITORY}/releases/download/v#{version}`;
  return `cask "mirador" do
  version "${version}"
  sha256 arm:          "${sha256.macosArm64}",
         arm64_linux:  "${sha256.linuxArm64}",
         x86_64_linux: "${sha256.linuxX64}"

  on_macos do
    url "${download}/${CASK_ASSETS.macosArm64}"

    depends_on arch: :arm64

    app "Mirador.app"

    uninstall launchctl: [
                "com.sodre90.mirador.host.4600",
                "com.sodre90.mirador.open-at-login.4600",
              ],
              quit:      "com.sodre90.mirador"

    zap trash: [
      "~/Library/Application Support/com.sodre90.mirador",
      "~/Library/Preferences/com.sodre90.mirador.plist",
      "~/Library/WebKit/com.sodre90.mirador",
    ]
  end
  on_linux do
    arch arm: "arm64", intel: "x64"

    url "${download}/Mirador-linux-#{arch}-Setup.tar.gz"

    installer script: {
      executable: "installer",
    }

    uninstall script: {
                executable:   "pkill",
                args:         ["-f", "#{Dir.home}/.local/share/com.sodre90.mirador/stable/app/bin/"],
                must_succeed: false,
              },
              trash:  [
                "~/.config/autostart/mirador-*.desktop",
                "~/.local/share/applications/Mirador.desktop",
                "~/.local/share/com.sodre90.mirador/stable/.electrobun-uninstall.json",
                "~/.local/share/com.sodre90.mirador/stable/app",
                "~/.local/share/com.sodre90.mirador/stable/self-extraction",
                "~/.local/share/com.sodre90.mirador/stable/uninstall",
              ]

    zap trash: [
      "~/.cache/com.sodre90.mirador",
      "~/.local/share/com.sodre90.mirador",
    ]

    caveats <<~EOS
      Mirador needs glibc 2.36 or newer (Ubuntu 24.04, Debian 12, Fedora 37 or later),
      and GTK 3, WebKitGTK 4.1, Ayatana AppIndicator and librsvg:
        sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2   # Debian, Ubuntu
        sudo dnf install gtk3 webkit2gtk4.1 libayatana-appindicator-gtk3 librsvg2              # Fedora

      Before you uninstall, turn off Run host in the background in the app's tray menu.
    EOS
  end

  name "Mirador"
  desc "Canvas for coding agents to draw, ask and review beside the conversation"
  homepage "https://mirador.sodre90.com/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
end
`;
}

const sha256Of = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

if (import.meta.main) {
  const dist = process.argv[2];
  if (!dist) throw new Error("Usage: homebrew-cask.ts <dist>");
  const checksums = Object.fromEntries(Object.entries(CASK_ASSETS).map(([asset, file]) => [asset, sha256Of(join(dist, file))])) as CaskChecksums;
  writeFileSync(join(dist, "mirador.rb"), homebrewCask(MIRADOR_VERSION, checksums));
  console.log(`Wrote ${join(dist, "mirador.rb")} for Mirador ${MIRADOR_VERSION}`);
}
