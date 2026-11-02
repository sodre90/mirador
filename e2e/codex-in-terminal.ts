#!/usr/bin/env bun
/**
 * Runs the interactive Codex in a terminal of its own, as a user does, with a first prompt, and quits it once the scripted
 * model's echo of that prompt shows: `bun e2e/codex-in-terminal.ts <codex> <prompt>`, in the folder the session belongs to.
 * Codex lists only sessions started so, not those of `codex exec`.
 */
const [codex, prompt] = process.argv.slice(2);
if (!codex || !prompt) throw new Error("usage: codex-in-terminal.ts <codex> <prompt>");

const ANSWER_TIMEOUT_MS = 60_000;
const QUIT_TIMEOUT_MS = 10_000;
const decoder = new TextDecoder();
let screen = "";
const plainText = (text: string) => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");

/** npm installs codex as codex.cmd on Windows, which only cmd runs. */
const command = process.platform === "win32" ? ["cmd", "/c", codex, prompt] : [codex, prompt];
const child = Bun.spawn(command, {
  env: { ...process.env, TERM: "xterm-256color" },
  terminal: { cols: 200, rows: 50, data: (_terminal, bytes) => void (screen += decoder.decode(bytes, { stream: true })) },
});

const deadline = Date.now() + ANSWER_TIMEOUT_MS;
while (!plainText(screen).replace(/\s+/g, "").includes(`Echo:${prompt}`)) {
  if (Date.now() > deadline || child.exitCode !== null) {
    console.error(plainText(screen).slice(-4000));
    child.kill();
    process.exit(1);
  }
  await Bun.sleep(200);
}
await quitAsAUserDoes();

/** Ctrl+C twice, as Codex asks; killing the codex command would leave the Codex it starts holding the session. */
async function quitAsAUserDoes() {
  for (const _press of [1, 2]) {
    if (!pressCtrlC()) break;
    await Bun.sleep(500);
  }
  const quit = await Promise.race([child.exited.then(() => true), Bun.sleep(QUIT_TIMEOUT_MS).then(() => false)]);
  if (!quit) {
    console.error(plainText(screen).slice(-4000));
    process.exit(1);
  }
}

/** False once Codex has quit and taken its terminal with it, as it can after the first press on Windows. */
function pressCtrlC() {
  if (child.exitCode !== null) return false;
  try {
    child.terminal!.write("\x03");
    return true;
  } catch {
    return false;
  }
}

export {};
