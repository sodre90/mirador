import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Profile } from "../../shared/model.ts";
import type { EnvironmentChoices } from "../../shared/room-agent-setup.ts";
import type { PiModelElsewhere } from "../../shared/sandbox.ts";
import { profileEnvironmentToCome } from "../acp/harnesses.ts";
import { holdsASecret } from "./agent-environment.ts";
import { secretsOf, type ModelApi, type ModelRoute } from "./model-proxy.ts";

/** What pi reads of its agent folder for its model, each file as parsed: null where it has none or it can't be read. */
export interface PiAgentFiles {
  models: unknown;
  settings: unknown;
  auth: unknown;
}

/**
 * pi's default provider of models.json as the VM's pi gets it, with only the models that go its way and without its
 * address, key or headers, which the model proxy keeps on this computer; and the settings that choose its model.
 */
export interface PiModelInVm {
  providerId: string;
  provider: Record<string, unknown>;
  settings: Record<string, unknown>;
}

/** How a pi profile reaches its default model through the model proxy: the route, what the VM's pi gets, and the variables its key and headers come from. */
export interface PiThroughProxy {
  route: ModelRoute;
  inVm: PiModelInVm;
  keyVariables: string[];
}

export type PiSandboxSetup = PiThroughProxy | { elsewhere: PiModelElsewhere };

const STOOD_IN_FOR: ModelApi[] = ["anthropic-messages", "openai-completions", "openai-responses"];

/** The settings that choose pi's model and how it asks for it; the rest name folders, packages and programs of this computer. */
const MODEL_SETTINGS = ["defaultProvider", "defaultModel", "defaultThinkingLevel", "enabledModels", "compaction", "httpIdleTimeoutMs", "retry"];

/** What of a provider the VM's pi never gets: the model proxy stands in for its address, key and headers, and the VM knows no other model of it. */
const KEPT_OF_THE_PROVIDER = ["baseUrl", "apiKey", "authHeader", "headers", "oauth", "models", "modelOverrides"];

/** What of a model the VM's pi gets from its provider instead. */
const KEPT_OF_A_MODEL = ["baseUrl", "api"];

type Named = Record<string, unknown>;

const isNamed = (value: unknown): value is Named => typeof value === "object" && value !== null && !Array.isArray(value);

const namedIn = (value: unknown, name: string): Named | null => (isNamed(value) && isNamed(value[name]) ? value[name] : null);

const without = (named: Named, kept: string[]) => Object.fromEntries(Object.entries(named).filter(([name]) => !kept.includes(name)));

const VARIABLE_REFERENCE = /\$(?:([$!])|\{([^}]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A value of pi's config as pi resolves it: a command where it starts with `!`, else its text with `$NAME` and `${NAME}`
 * from the environment and `$$` and `$!` as `$` and `!`, undefined where a variable it names is unset or empty.
 */
export function piConfigValue(config: string, environment: Record<string, string>): { command: true } | { value: string | undefined; variables: string[] } {
  if (config.startsWith("!")) return { command: true };
  const variables: string[] = [];
  const value = config.replace(VARIABLE_REFERENCE, (reference, escaped?: string, braced?: string, bare?: string) => {
    if (escaped) return escaped;
    if (braced !== undefined && !VARIABLE_NAME.test(braced)) return reference;
    const name = braced ?? bare!;
    variables.push(name);
    return environment[name] ?? "";
  });
  return { value: variables.every((name) => environment[name]) ? value : undefined, variables };
}

type Resolved = { value: string; variables: string[] } | { elsewhere: PiModelElsewhere };

function resolved(config: string, environment: Record<string, string>): Resolved {
  const resolving = piConfigValue(config, environment);
  if ("command" in resolving) return { elsewhere: "key-from-command" };
  return resolving.value === undefined ? { elsewhere: "no-key" } : { value: resolving.value, variables: resolving.variables };
}

const ownEnvironmentOf = (credential: Named | null): Record<string, string> =>
  isNamed(credential?.env) ? Object.fromEntries(Object.entries(credential.env).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "")) : {};

/**
 * The provider's key as pi takes it: auth.json's credential where it has one, which shuts out models.json's key; an
 * OAuth sign-in being none the proxy can hold.
 */
function keyOf(provider: Named, credential: Named | null, environment: Record<string, string>): Resolved {
  if (credential?.type === "oauth" || provider.oauth !== undefined) return { elsewhere: "signs-in" };
  if (credential?.type === "api_key") return typeof credential.key === "string" ? resolved(credential.key, environment) : { elsewhere: "no-key" };
  return typeof provider.apiKey === "string" ? resolved(provider.apiKey, environment) : { elsewhere: "no-key" };
}

/** The provider's headers with their values resolved, as pi does on each request: one it can't resolve fails the request, so the proxy can't stand in. */
function headersOf(provider: Named, environment: Record<string, string>): { headers: [string, string][]; variables: string[] } | { elsewhere: PiModelElsewhere } {
  const given = Object.entries(isNamed(provider.headers) ? provider.headers : {}).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  const headers: [string, string][] = [];
  const variables: string[] = [];
  for (const [name, config] of given) {
    const value = resolved(config, environment);
    if ("elsewhere" in value) return value;
    headers.push([name, value.value]);
    variables.push(...value.variables);
  }
  return { headers, variables };
}

const apiOf = (provider: Named, model: Named) => model.api ?? provider.api;

const addressOf = (provider: Named, model: Named) => model.baseUrl ?? provider.baseUrl;

/** Whether a model goes where the default model does, the way it does, so one route serves both. */
const goesTheWayOf = (provider: Named, chosen: Named) => (model: Named) =>
  model.headers === undefined && apiOf(provider, model) === apiOf(provider, chosen) && addressOf(provider, model) === addressOf(provider, chosen);

const isWebAddress = (value: unknown): value is string => typeof value === "string" && /^https?:\/\//.test(value);

const isStoodInFor = (api: unknown): api is ModelApi => STOOD_IN_FOR.includes(api as ModelApi);

/**
 * How pi with these files and this environment reaches its default model through the model proxy, or why the proxy
 * can't stand in for it: the model has to be one of a models.json provider's, on an API the proxy speaks, with a key of
 * its own. The VM's pi gets only that provider's models that go the default model's way.
 */
export function piSandboxSetupOf({ models, settings, auth }: PiAgentFiles, environment: Record<string, string>): PiSandboxSetup {
  const { defaultProvider, defaultModel } = isNamed(settings) ? settings : {};
  if (typeof defaultProvider !== "string" || typeof defaultModel !== "string") return { elsewhere: "no-default-model" };
  const provider = namedIn(namedIn(models, "providers"), defaultProvider);
  const providerModels = Array.isArray(provider?.models) ? provider.models.filter(isNamed) : [];
  const chosen = providerModels.find(({ id }) => id === defaultModel);
  if (!provider || !chosen) return { elsewhere: "built-in-provider" };
  const api = apiOf(provider, chosen);
  const upstream = addressOf(provider, chosen);
  if (!isStoodInFor(api) || !isWebAddress(upstream) || chosen.headers !== undefined) return { elsewhere: "unsupported-provider" };
  const credential = namedIn(auth, defaultProvider);
  const keyEnvironment = { ...environment, ...ownEnvironmentOf(credential) };
  const key = keyOf(provider, credential, keyEnvironment);
  if ("elsewhere" in key) return key;
  const headers = headersOf(provider, keyEnvironment);
  if ("elsewhere" in headers) return headers;
  const modelsInVm = providerModels.filter(goesTheWayOf(provider, chosen));
  const inVm: PiModelInVm = {
    providerId: defaultProvider,
    provider: { ...without(provider, KEPT_OF_THE_PROVIDER), api, models: modelsInVm.map((model) => without(model, KEPT_OF_A_MODEL)) },
    settings: Object.fromEntries(Object.entries(settings as Named).filter(([name]) => MODEL_SETTINGS.includes(name))),
  };
  const keyHeader = api === "anthropic-messages" && provider.authHeader !== true ? "x-api-key" : "authorization";
  const allowed = { families: [], ids: modelsInVm.flatMap(({ id }) => (typeof id === "string" ? [id] : [])) };
  const route: ModelRoute = { upstream, api, key: key.value, keyHeader, headers: headers.headers, models: allowed };
  if (holdsASecret(secretsOf(route))(JSON.stringify(inVm))) return { elsewhere: "unsupported-provider" };
  return { route, inVm, keyVariables: [...new Set([...key.variables, ...headers.variables])] };
}

const parsedFile = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

/** pi's agent folder, as pi takes it from its environment. */
export const piAgentFolderOf = (environment: Record<string, string>) => {
  const named = environment.PI_CODING_AGENT_DIR;
  if (!named) return join(homedir(), ".pi", "agent");
  return named === "~" || named.startsWith("~/") ? join(homedir(), named.slice(1)) : named;
};

export const piAgentFilesIn = (folder: string): PiAgentFiles => ({
  models: parsedFile(join(folder, "models.json")),
  settings: parsedFile(join(folder, "settings.json")),
  auth: parsedFile(join(folder, "auth.json")),
});

/**
 * What pi resolves its key from on this computer: the profile's whole environment over this computer's, but for the
 * values a room's owner kept from its agent. The key goes no further than the model proxy, so it need not be among what
 * the agent is given.
 */
function keyEnvironmentOf(profile: Profile, { variables }: EnvironmentChoices) {
  try {
    return Object.fromEntries(Object.entries(profileEnvironmentToCome(profile)).filter(([name]) => variables[name] !== false));
  } catch {
    return {};
  }
}

/** How a pi profile's agent reaches its default model through the model proxy, as its room or workspace gives it its environment. */
export function piSandboxSetupFor(profile: Profile, choices: EnvironmentChoices): PiSandboxSetup {
  const environment = keyEnvironmentOf(profile, choices);
  return piSandboxSetupOf(piAgentFilesIn(piAgentFolderOf(environment)), environment);
}
