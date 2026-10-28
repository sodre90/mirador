import type { ElectrobunConfig } from "electrobun";
import { join, resolve } from "node:path";
import { RELEASES_REPOSITORY } from "../shared/newer-version.ts";
import { MIRADOR_VERSION } from "../shared/version.ts";
import { buildMachineBun } from "./scripts/ship-build-bun.ts";

const hostDirectory = resolve(import.meta.dir, "..");
const bun = buildMachineBun();
/** `bun run build:release`: the app carries Mirador, staged by scripts/stage-mirador.ts, instead of running this checkout. */
const carriesMirador = process.env.MIRADOR_DESKTOP_RELEASE === "1";
/** Worked out by the Bun the host runs on: Electrobun's command line may evaluate this file on another Bun, whose transpiler can write the same code differently. */
const builtFromCode = () => Bun.spawnSync([bun, join(hostDirectory, "shared", "desktop-app-code.ts"), import.meta.dir]).stdout.toString().trim() || null;

export default {
  app: {
    name: "Mirador",
    identifier: "com.sodre90.mirador",
    version: MIRADOR_VERSION,
  },
  build: {
    mainProcess: "bun",
    bun: {
      entrypoint: "src/bun/index.ts",
      define: {
        BUILD_HOST_DIRECTORY: JSON.stringify(carriesMirador ? null : hostDirectory),
        BUILD_BUN: JSON.stringify(carriesMirador ? null : bun),
        BUILD_DESKTOP_APP_CODE: JSON.stringify(carriesMirador ? null : builtFromCode()),
      },
    },
    copy: {
      "assets/tray-icon.png": "views/assets/tray-icon.png",
      "icon.iconset/icon_32x32@2x.png": "views/assets/app-icon.png",
      "assets/tray-icon-needs-you.png": "views/assets/tray-icon-needs-you.png",
      "assets/tray-icon-done.png": "views/assets/tray-icon-done.png",
      ...(carriesMirador && { "release/mirador": "mirador" }),
    },
    mac: { createDmg: false, icons: "icon.iconset", codesign: true, entitlements: { "com.apple.security.device.audio-input": true } },
    linux: { icon: "icon.iconset/icon_512x512.png" },
    win: { icon: "icon.iconset/icon_256x256.png" },
  },
  /** Only a release build updates itself; its patches come from `make update-files`, as Electrobun's would diff the unsigned macOS app. */
  ...(carriesMirador && { release: { baseUrl: `https://github.com/${RELEASES_REPOSITORY}/releases/latest/download`, generatePatch: false } }),
  scripts: { postBuild: "scripts/post-build.ts" },
  runtime: { exitOnLastWindowClosed: false },
} satisfies ElectrobunConfig;
