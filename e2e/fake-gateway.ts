import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string;
  body: string;
}

/**
 * Stands in for a work gateway or local model server: records who called and refuses every request,
 * except the one-token check Claude Code makes before it switches a running session to a model.
 */
export class FakeGateway {
  readonly requests: RecordedRequest[] = [];
  private server?: Server;

  async start() {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        this.requests.push({
          method: request.method!,
          path: request.url!,
          authorization: request.headers.authorization ?? "",
          body,
        });
        response.writeHead(isModelCheck(body) ? 200 : 400, { "content-type": "application/json" });
        response.end(JSON.stringify(isModelCheck(body) ? modelCheckReply(body) : refusal));
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
  }

  get url() {
    return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  messageRequests() {
    return this.requests.filter(({ method, path }) => method === "POST" && path.startsWith("/v1/messages"));
  }

  tokensSentToMessages() {
    return this.messageRequests().map(({ authorization }) => authorization);
  }

  stop() {
    this.server?.close();
  }
}

const refusal = { type: "error", error: { type: "invalid_request_error", message: "fake gateway says no" } };

function isModelCheck(body: string) {
  try {
    return JSON.parse(body).max_tokens === 1;
  } catch {
    return false;
  }
}

const modelCheckReply = (body: string) => ({
  id: "msg_model_check",
  type: "message",
  role: "assistant",
  model: JSON.parse(body).model,
  content: [{ type: "text", text: "Hi" }],
  stop_reason: "max_tokens",
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
});

export const gatewayEnvironment = (gateway: FakeGateway, token = "e2e-gateway-token") =>
  ["-u ANTHROPIC_API_KEY", `ANTHROPIC_BASE_URL=${gateway.url}`, `ANTHROPIC_AUTH_TOKEN=${token}`].join("\n");
