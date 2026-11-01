import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const NODE_BIN_DIR = "/Users/perdos/.nvm/versions/node/v22.13.1/bin";
const NODE = `${NODE_BIN_DIR}/node`;

export const agentCommands: Record<string, string[]> = {
  claude: [process.execPath, "node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js"],
  opencode: ["/opt/homebrew/bin/opencode", "acp"],
  "pi-acp": [NODE, "node_modules/pi-acp/dist/index.js"],
  "pi-acp-liuser": [NODE, "node_modules/@liuser/pi-acp/dist/index.js"],
};

export function spawnAgent(name: string, extraEnv: Record<string, string> = {}) {
  const [command, ...args] = agentCommands[name];
  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PATH: `${NODE_BIN_DIR}:${process.env.PATH}`, ...extraEnv },
  });
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name} stderr] ${chunk}`));
  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin!), Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>);
  return { child, stream };
}
