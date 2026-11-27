import { describe, expect, test } from "bun:test";
import { environmentInVm, KEY_PLACEHOLDER, PI_IN_VM } from "../host/sandbox/agent-environment.ts";
import { secretsOf } from "../host/sandbox/model-proxy.ts";
import { BUN_FOLDER_IN_VM, NODE_FOLDER_IN_VM } from "../host/sandbox/tools-folder.ts";
import { piConfigValue, piSandboxSetupOf, type PiAgentFiles, type PiThroughProxy } from "../host/sandbox/pi-setup.ts";

const GATEWAY_KEY = "gw-key-of-the-gateway-4321";
const TEAM = "team-of-the-gateway";
const ENVIRONMENT = { LLM_GATEWAY_KEY: GATEWAY_KEY, GATEWAY_TEAM: TEAM, EMPTY: "" };

const gatewayModel = { id: "gpt-6.1", name: "GPT 6.1", reasoning: true, input: ["text", "image"], contextWindow: 400_000 };

/** A models.json gateway provider of the owner's kind: OpenAI's Responses API at an https address ending in /v1, its key from a variable. */
const gatewayFiles = (provider: Record<string, unknown> = {}, settings: Record<string, unknown> = {}, auth: unknown = null): PiAgentFiles => ({
  models: {
    providers: {
      gateway: { baseUrl: "https://llm-gateway.example/v1", api: "openai-responses", apiKey: "${LLM_GATEWAY_KEY}", models: [gatewayModel], ...provider },
      other: { baseUrl: "https://other.example/v1", api: "openai-completions", apiKey: "sk-other-provider-key", models: [{ id: "other-model" }] },
    },
  },
  settings: { defaultProvider: "gateway", defaultModel: "gpt-6.1", defaultThinkingLevel: "high", packages: ["npm:pi-web-access"], extensions: ["/Users/me/ext.ts"], theme: "dark", ...settings },
  auth,
});

const throughProxy = (files: PiAgentFiles, environment: Record<string, string> = ENVIRONMENT) => {
  const setup = piSandboxSetupOf(files, environment);
  if ("elsewhere" in setup) throw new Error(`the proxy can't stand in: ${setup.elsewhere}`);
  return setup;
};

const elsewhereOf = (files: PiAgentFiles, environment: Record<string, string> = ENVIRONMENT) => {
  const setup = piSandboxSetupOf(files, environment);
  return "elsewhere" in setup ? setup.elsewhere : null;
};

describe("a value of pi's config, as pi resolves it", () => {
  test("takes $NAME and ${NAME} from the environment, $$ and $! as $ and !, and leaves what names no variable as it is", () => {
    const environment = { KEY: "k1", OTHER: "o2" };
    expect(piConfigValue("$KEY", environment)).toEqual({ value: "k1", variables: ["KEY"] });
    expect(piConfigValue("${KEY}", environment)).toEqual({ value: "k1", variables: ["KEY"] });
    expect(piConfigValue("Bearer ${KEY}-$OTHER", environment)).toEqual({ value: "Bearer k1-o2", variables: ["KEY", "OTHER"] });
    expect(piConfigValue("$$KEY and $!", environment)).toEqual({ value: "$KEY and !", variables: [] });
    expect(piConfigValue("${not a name} ${unclosed $ 5", environment)).toEqual({ value: "${not a name} ${unclosed $ 5", variables: [] });
    expect(piConfigValue("literal-key", environment)).toEqual({ value: "literal-key", variables: [] });
  });

  test("is undefined where a variable it names is unset or empty, and a command where it starts with !", () => {
    expect(piConfigValue("${MISSING}", {})).toEqual({ value: undefined, variables: ["MISSING"] });
    expect(piConfigValue("$EMPTY", { EMPTY: "" })).toEqual({ value: undefined, variables: ["EMPTY"] });
    expect(piConfigValue("!op read op://vault/key", { KEY: "k1" })).toEqual({ command: true });
  });
});

describe("how pi reaches its default model from a sandbox", () => {
  test("a models.json provider on OpenAI's Responses API goes through the proxy: the key and headers stay on this computer, the VM gets the provider's models that go its way", () => {
    const files = gatewayFiles({
      headers: { "X-Team": "$GATEWAY_TEAM" },
      authHeader: true,
      modelOverrides: { "gpt-5": { name: "Old" } },
      models: [gatewayModel, { id: "mini", name: "Mini" }, { id: "elsewhere", baseUrl: "https://elsewhere.example/v1" }, { id: "chatty", api: "openai-completions" }, { id: "headed", headers: { "X-Model": "m" } }],
    });

    const { route, inVm, keyVariables } = throughProxy(files);

    expect(route).toEqual({ upstream: "https://llm-gateway.example/v1", api: "openai-responses", key: GATEWAY_KEY, keyHeader: "authorization", headers: [["X-Team", TEAM]] });
    expect(keyVariables.toSorted()).toEqual(["GATEWAY_TEAM", "LLM_GATEWAY_KEY"]);
    expect(inVm.providerId).toBe("gateway");
    expect(inVm.provider).toEqual({ api: "openai-responses", models: [gatewayModel, { id: "mini", name: "Mini" }] });
    expect(inVm.settings).toEqual({ defaultProvider: "gateway", defaultModel: "gpt-6.1", defaultThinkingLevel: "high" });
  });

  test("Anthropic's Messages API takes the key as x-api-key, or as a bearer token where the provider says so; a model may name the API its provider leaves out", () => {
    const anthropic = (provider: Record<string, unknown>) => gatewayFiles({ baseUrl: "https://anthropic-gateway.example", api: "anthropic-messages", ...provider });
    expect(throughProxy(anthropic({})).route).toMatchObject({ api: "anthropic-messages", keyHeader: "x-api-key" });
    expect(throughProxy(anthropic({ authHeader: true })).route).toMatchObject({ keyHeader: "authorization" });
    const onTheModel = throughProxy(gatewayFiles({ api: undefined, models: [{ ...gatewayModel, api: "openai-completions" }, { id: "no-api" }] }));
    expect(onTheModel.route.api).toBe("openai-completions");
    expect(onTheModel.inVm.provider).toEqual({ api: "openai-completions", models: [gatewayModel] });
  });

  test("auth.json's key wins over models.json's, resolved with its own values first, and a credential without a key shuts models.json's out as pi does", () => {
    const literal = throughProxy(gatewayFiles({}, {}, { gateway: { type: "api_key", key: "auth-json-key-5678" } }));
    expect(literal.route.key).toBe("auth-json-key-5678");
    expect(literal.keyVariables).toEqual([]);
    const fromItsValues = throughProxy(gatewayFiles({ headers: { "X-Team": "$GATEWAY_TEAM" } }, {}, { gateway: { type: "api_key", key: "${AUTH_KEY}", env: { AUTH_KEY: "auth-env-key-9999", GATEWAY_TEAM: "auth-team" } } }));
    expect(fromItsValues.route).toMatchObject({ key: "auth-env-key-9999", headers: [["X-Team", "auth-team"]] });
    expect(fromItsValues.keyVariables.toSorted()).toEqual(["AUTH_KEY", "GATEWAY_TEAM"]);
    expect(elsewhereOf(gatewayFiles({}, {}, { gateway: { type: "api_key" } }))).toBe("no-key");
    expect(throughProxy(gatewayFiles({}, {}, { other: { type: "api_key", key: "another-providers-key" } })).route.key).toBe(GATEWAY_KEY);
  });

  test("has no default model to reach where settings.json names none", () => {
    expect(elsewhereOf({ ...gatewayFiles(), settings: null })).toBe("no-default-model");
    expect(elsewhereOf(gatewayFiles({}, { defaultModel: undefined }))).toBe("no-default-model");
  });

  test("can't stand in for a model pi knows by itself: a built-in provider, or one models.json only moves", () => {
    expect(elsewhereOf(gatewayFiles({}, { defaultProvider: "anthropic", defaultModel: "claude-opus-5" }))).toBe("built-in-provider");
    expect(elsewhereOf(gatewayFiles({}, { defaultModel: "a-built-in-model" }))).toBe("built-in-provider");
    expect(elsewhereOf({ ...gatewayFiles(), models: null })).toBe("built-in-provider");
  });

  test("can't stand in for an API it doesn't speak, an address that isn't the web's, or a default model with headers of its own", () => {
    expect(elsewhereOf(gatewayFiles({ api: "google-generative-ai" }))).toBe("unsupported-provider");
    expect(elsewhereOf(gatewayFiles({ api: "openai-codex-responses" }))).toBe("unsupported-provider");
    expect(elsewhereOf(gatewayFiles({ baseUrl: "unix:///tmp/model.sock" }))).toBe("unsupported-provider");
    expect(elsewhereOf(gatewayFiles({ models: [{ ...gatewayModel, headers: { "X-Model": "m" } }] }))).toBe("unsupported-provider");
  });

  test("can't stand in where the VM's models.json would hold the key, as a provider's name could", () => {
    expect(elsewhereOf(gatewayFiles({ name: `Gateway ${GATEWAY_KEY}` }))).toBe("unsupported-provider");
    expect(elsewhereOf(gatewayFiles({ models: [{ ...gatewayModel, name: TEAM }], headers: { "X-Team": "$GATEWAY_TEAM" } }))).toBe("unsupported-provider");
  });

  test("can't hold an OAuth sign-in for pi", () => {
    expect(elsewhereOf(gatewayFiles({}, {}, { gateway: { type: "oauth", access: "a", refresh: "r", expires: 1 } }))).toBe("signs-in");
    expect(elsewhereOf(gatewayFiles({ oauth: "radius" }))).toBe("signs-in");
  });

  test("runs no command for a key or header", () => {
    expect(elsewhereOf(gatewayFiles({ apiKey: "!op read op://vault/key" }))).toBe("key-from-command");
    expect(elsewhereOf(gatewayFiles({ headers: { "X-Team": "!whoami" } }))).toBe("key-from-command");
    expect(elsewhereOf(gatewayFiles({}, {}, { gateway: { type: "api_key", key: "!security find-generic-password -w" } }))).toBe("key-from-command");
  });

  test("has no key where none is set, or a variable its key or a header needs is unset or empty, as pi's request would fail", () => {
    expect(elsewhereOf(gatewayFiles({ apiKey: undefined }))).toBe("no-key");
    expect(elsewhereOf(gatewayFiles(), {})).toBe("no-key");
    expect(elsewhereOf(gatewayFiles({ apiKey: "$EMPTY" }))).toBe("no-key");
    expect(elsewhereOf(gatewayFiles({ headers: { "X-Team": "${MISSING}" } }))).toBe("no-key");
  });
});

describe("pi's environment in the VM", () => {
  const setup: PiThroughProxy = throughProxy(gatewayFiles({ headers: { "X-Team": "$GATEWAY_TEAM" } }));
  const given = {
    PI_CODING_AGENT_DIR: "/Users/me/.pi/agent",
    PI_ACP_PI_COMMAND: "/Users/me/.local/bin/pi",
    PI_CODING_AGENT_SESSION_DIR: "/Users/me/sessions",
    PI_ACP_QUIET_STARTUP: "true",
    LLM_GATEWAY_KEY: GATEWAY_KEY,
    GATEWAY_TEAM: TEAM,
    OPENAI_API_KEY: "sk-another-providers-key",
    ANTHROPIC_BASE_URL: "https://elsewhere.example",
    ECHOED: `prefix ${GATEWAY_KEY}`,
    HOME: "/Users/me",
    DEPLOY: "staging",
  };
  const agent = { kind: { harness: "pi" as const, model: setup.inVm, keyVariables: setup.keyVariables }, version: "1.6.0", base: { image: "debian", path: "/usr/bin:/bin" } };
  const inVm = environmentInVm(given, agent, { configFolder: "/data/sandbox/workspaces/w1/pi", modelBaseUrl: "http://127.0.0.1:7702/p/pier" }, secretsOf(setup.route));

  test("has no key, no header value, no model provider's values and none of this computer's pi places", () => {
    expect(JSON.stringify(inVm)).not.toContain(GATEWAY_KEY);
    expect(JSON.stringify(inVm)).not.toContain(TEAM);
    expect(["LLM_GATEWAY_KEY", "GATEWAY_TEAM", "OPENAI_API_KEY", "ANTHROPIC_BASE_URL", "ECHOED", "PI_CODING_AGENT_SESSION_DIR"].filter((name) => Object.hasOwn(inVm, name))).toEqual([]);
    expect(inVm).toMatchObject({ PI_CODING_AGENT_DIR: "/data/sandbox/workspaces/w1/pi", PI_ACP_PI_COMMAND: PI_IN_VM, PI_OFFLINE: "1", PI_ACP_QUIET_STARTUP: "true", HOME: "/tmp/mirador-home", DEPLOY: "staging" });
    expect(inVm.PATH).toBe(`/opt/mirador/pi-1.6.0/bin:${BUN_FOLDER_IN_VM}:${NODE_FOLDER_IN_VM}:/usr/bin:/bin`);
  });

  test("gives pi its default provider alone, at the proxy's relay, with a key that is none, and only the settings that choose its model", () => {
    expect(JSON.parse(inVm.MIRADOR_PI_MODELS!)).toEqual({ providers: { gateway: { api: "openai-responses", models: [gatewayModel], baseUrl: "http://127.0.0.1:7702/p/pier", apiKey: KEY_PLACEHOLDER } } });
    expect(JSON.parse(inVm.MIRADOR_PI_SETTINGS!)).toEqual({ defaultProvider: "gateway", defaultModel: "gpt-6.1", defaultThinkingLevel: "high" });
  });
});
