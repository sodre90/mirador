import * as acp from "@agentclientprotocol/sdk";
import { spawnAgent } from "./agents";

const name = process.argv[2];
const { child, stream } = spawnAgent(name);
const timeout = setTimeout(() => { console.log(`${name}: initialize timed out`); child.kill(); process.exit(1); }, 30_000);

const result = await acp.client({ name: "probe" }).connectWith(stream, (ctx) =>
  ctx.request(acp.methods.agent.initialize, {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: {},
  }),
);
clearTimeout(timeout);
console.log(JSON.stringify({ agent: name, protocolVersion: result.protocolVersion, agentInfo: result.agentInfo, agentCapabilities: result.agentCapabilities }, null, 2));
child.kill();
process.exit(0);
