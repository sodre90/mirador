import * as acp from "@agentclientprotocol/sdk";
import { spawnAgent } from "./agents";

const { child, stream } = spawnAgent("claude");
const updates: unknown[] = [];
const connection = acp
  .client({ name: "probe" })
  .onNotification(acp.methods.client.session.update, (ctx) => { updates.push(ctx.params.update); })
  .connect(stream);
await connection.agent.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
const response = await connection.agent.request(acp.methods.agent.session.new, {
  cwd: process.cwd(),
  mcpServers: [],
  _meta: { claudeCode: { options: { env: { CLAUDE_NOTIFIER: "0" }, disallowedTools: ["AskUserQuestion"] } } },
});
await Bun.sleep(1500);
console.log(JSON.stringify(response, null, 1).slice(0, 4000));
console.log("updates:", JSON.stringify(updates.map((u: any) => ({ kind: u.sessionUpdate, n: u.availableCommands?.length })), null, 0));
connection.close();
child.kill();
process.exit(0);
