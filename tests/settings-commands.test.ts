import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostConfig } from "../host/config.ts";
import { SettingsImportCommand } from "../host/settings-file/command-line.ts";
import { Store } from "../host/store.ts";
import { aFolder, aProfile, aStore, importInto, textOf } from "./settings-move.ts";

const cli = join(import.meta.dir, "..", "host", "cli.ts");

async function mirador(dataDir: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, cli, ...args], { env: { ...process.env, MIRADOR_DATA_DIR: dataDir, MIRADOR_PORT: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, exitCode };
}

function aDataDir() {
  const dataDir = aFolder();
  const store = new Store(join(dataDir, "state.sqlite"));
  store.saveProfile(aProfile({ name: "gateway", environment: "TOKEN=sk-secret", prelaunch: "vpn up" }));
  store.close();
  return dataDir;
}

describe("mirador export-settings", () => {
  test("prints the settings, with what they hold said apart from them", async () => {
    const { stdout, stderr, exitCode } = await mirador(aDataDir(), "export-settings");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ schemaVersion: 1, profiles: [{ name: "gateway", environment: { TOKEN: { needsValue: true } } }] });
    expect(stderr).toContain("--include-secrets puts them in");
    expect(stderr).toContain("Pre-launch commands are in it as written");
  });

  test.skipIf(process.platform === "win32")("writes them to a file only this user may read, also over one anyone could", async () => {
    const out = join(aFolder(), "settings.json");
    writeFileSync(out, "old", { mode: 0o644 });

    const { stdout, stderr, exitCode } = await mirador(aDataDir(), "export-settings", "--out", out, "--include-secrets");

    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 0 });
    expect(stderr).toContain(`1 profile, `);
    expect(stderr).toContain("It holds your secrets");
    expect(readFileSync(out, "utf8")).toContain("sk-secret");
    expect(statSync(out).mode & 0o777).toBe(0o600);
  });
});

test("mirador import-settings says so when no Mirador runs, or the file is none", async () => {
  const file = join(aFolder(), "settings.json");
  writeFileSync(file, textOf({}));
  expect(await mirador(aDataDir(), "import-settings", file)).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("Mirador is not running at") });
  expect(await mirador(aDataDir(), "import-settings", `${file}.none`)).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("no such file") });
  expect(await mirador(aDataDir(), "import-settings")).toMatchObject({ exitCode: 2, stderr: expect.stringContaining("usage: mirador import-settings") });
});

describe("mirador import-settings", () => {
  const store = aStore();
  const settingsImport = importInto(store);
  const authorized: (string | null)[] = [];
  const server = Bun.serve({
    port: 0,
    routes: {
      "/settings-import/plan": { POST: async (request) => Response.json(await settingsImport.plan(await request.text())) },
      "/settings-import": {
        POST: async (request) => {
          authorized.push(request.headers.get("Authorization"));
          const { text, items } = (await request.json()) as { text: string; items: string[] };
          return Response.json(await settingsImport.bringInChosen(text, items));
        },
      },
    },
  });
  afterAll(() => server.stop(true));

  const file = join(aFolder(), "settings.json");
  let printed: string[] = [];
  let log: ReturnType<typeof spyOn>;
  beforeEach(() => {
    store.listProfiles().forEach(({ id }) => store.deleteProfile(id));
    [aProfile({ name: "one", model: "opus" }), aProfile({ name: "two", model: "opus" })].forEach((profile) => store.saveProfile(profile));
    writeFileSync(file, textOf({ profiles: ["one", "two", "three"].map((name) => ({ name, harness: "claude", model: "haiku" })) }));
    printed = [];
    log = spyOn(console, "log").mockImplementation((line: string) => void printed.push(line));
  });
  afterEach(() => log.mockRestore());

  const config = { appOrigin: `http://127.0.0.1:${server.port}`, browserToken: "owner" } as HostConfig;
  const modelsHere = () => Object.fromEntries(store.listProfiles().map(({ name, model }) => [name, model]));

  async function importing(answers: (string | null)[], options = { overwrite: false, dryRun: false }) {
    const asked: string[] = [];
    const ask = (question: string) => {
      asked.push(question);
      return answers[asked.length - 1] ?? null;
    };
    await new SettingsImportCommand(config, ask).run(file, options);
    return asked;
  }

  test("adds what is new, and asks before it overwrites anything", async () => {
    const asked = await importing(["n", "y"]);

    expect(asked).toEqual([
      "Overwrite profile one (model) here with the file's? [y]es, [N]o, [a]ll:",
      "Overwrite profile two (model) here with the file's? [y]es, [N]o, [a]ll:",
    ]);
    expect(modelsHere()).toEqual({ one: "opus", two: "haiku", three: "haiku" });
    expect(printed).toEqual(["Added:\n  profile three", "Overwritten:\n  profile two (model)", "Kept as here:\n  profile one (model)"]);
    expect(authorized.at(-1)).toBe("Bearer owner");
  });

  test("with no one to answer, overwrites nothing", async () => {
    await importing([]);
    expect(modelsHere()).toEqual({ one: "opus", two: "opus", three: "haiku" });
  });

  test("an answer of all, like --overwrite, overwrites the rest without asking", async () => {
    expect(await importing(["a"])).toHaveLength(1);
    expect(modelsHere()).toEqual({ one: "haiku", two: "haiku", three: "haiku" });

    store.listProfiles().forEach((profile) => store.saveProfile({ ...profile, model: "opus" }));
    expect(await importing([], { overwrite: true, dryRun: false })).toEqual([]);
    expect(modelsHere()).toEqual({ one: "haiku", two: "haiku", three: "haiku" });
  });

  test("a dry run says what would change, and changes nothing", async () => {
    expect(await importing([], { overwrite: true, dryRun: true })).toEqual([]);
    expect(printed).toEqual(["New here:\n  profile three", "Different here:\n  profile one (model)\n  profile two (model)"]);
    expect(modelsHere()).toEqual({ one: "opus", two: "opus" });
  });

  test("says when there is nothing to bring in", async () => {
    await importing(["a"]);
    printed = [];
    await importing([]);
    expect(printed).toEqual(["Nothing to bring in."]);
  });
});
