#!/usr/bin/env bun
/** Electrobun runs this on the app it built, before it signs and wraps it. */
import { buildMachineBun, shipBuildBun } from "./ship-build-bun.ts";

const buildBun = buildMachineBun();
const { appBun, pinned, shipped } = shipBuildBun(process.env.ELECTROBUN_BUILD_DIR!, process.env.ELECTROBUN_OS!, buildBun);
console.log(shipped === pinned ? `${appBun}: Electrobun's Bun ${pinned}, the version of ${buildBun}` : `${appBun}: Bun ${shipped} from ${buildBun}, instead of Electrobun's ${pinned}`);
await import("./add-usage-descriptions.ts");
