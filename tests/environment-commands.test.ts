import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Profile } from "../shared/model.ts";
import { commandValues, readCommandValues, readMissingCommandValues } from "../host/acp/environment-commands.ts";
import { harnessSpec, profileEnvironment, profileEnvironmentOnceRead } from "../host/acp/harnesses.ts";
import { HarnessProcess } from "../host/acp/harness.ts";

const ownEnvironment = () => ({ ...process.env }) as Record<string, string>;

const profileWith = (environment: string): Profile => ({
  id: crypto.randomUUID(),
  name: "gateway",
  harness: "opencode",
  environment,
  prelaunch: "",
  model: null,
  mode: null,
  effort: null,
  bypassPermissions: false,
  askMode: "wait",
  color: null,
  pluginsOff: [],
  createdAt: 0,
});

const tokenFile = (token: string) => {
  const file = join(mkdtempSync(join(tmpdir(), "mirador-environment-commands-")), "token");
  writeFileSync(file, token);
  return file;
};

describe("a profile's environment commands", () => {
  test("give their variables nothing until they ran, then what they printed without its final line break", async () => {
    const file = tokenFile("sk-first\n");
    const profile = profileWith(`TOKEN=$(cat '${file}')\nPLAIN=written`);
    expect(profileEnvironment(profile)).not.toHaveProperty("TOKEN");

    await readCommandValues(profile, ownEnvironment());

    expect(commandValues(profile)).toEqual({ TOKEN: "sk-first" });
    expect(profileEnvironment(profile)).toMatchObject({ TOKEN: "sk-first", PLAIN: "written" });
  });

  test("run again as the agent starts, and only once for what reads its environment in between", async () => {
    const file = tokenFile("first");
    const profile = profileWith(`TOKEN=$(cat '${file}')`);
    expect(await profileEnvironmentOnceRead(profile)).toMatchObject({ TOKEN: "first" });

    writeFileSync(file, "second");
    expect(await profileEnvironmentOnceRead(profile)).toMatchObject({ TOKEN: "first" });

    const started = await harnessSpec(profile, "").readEnvironment!(new AbortController().signal);
    expect(started).toMatchObject({ TOKEN: "second" });
    expect(await profileEnvironmentOnceRead(profile)).toMatchObject({ TOKEN: "second" });
  });

  test("see the profile's other variables", async () => {
    const profile = profileWith('NAME=mirador\nGREETING=$(printf "hello %s" "$NAME")');
    expect(await profileEnvironmentOnceRead(profile)).toMatchObject({ GREETING: "hello mirador" });
  });

  test("of two profiles with the same command are read apart", async () => {
    const [mine, yours] = [profileWith('TOKEN=$(printf "$WHO")\nWHO=me'), profileWith('TOKEN=$(printf "$WHO")\nWHO=you')];
    await profileEnvironmentOnceRead(mine);
    await profileEnvironmentOnceRead(yours);
    expect([commandValues(mine).TOKEN, commandValues(yours).TOKEN]).toEqual(["me", "you"]);
  });

  test("that fail or print nothing say whose variable they give, with the error output but not what they printed", async () => {
    const failing = profileWith("TOKEN=$(echo sk-half; echo locked >&2; exit 4)");
    await expect(readCommandValues(failing, ownEnvironment())).rejects.toThrow('The command that gives profile "gateway" its TOKEN exited with 4: locked');
    expect(commandValues(failing)).toEqual({});

    await expect(readMissingCommandValues(profileWith("TOKEN=$(true)"), ownEnvironment)).rejects.toThrow('The command that gives profile "gateway" its TOKEN printed nothing');
  });

  test("are not run for a profile that has none", () => {
    expect(harnessSpec(profileWith("PLAIN=written"), "").readEnvironment).toBeUndefined();
  });
});

describe("an agent starting with environment commands", () => {
  const harnessReading = (environment: string, prelaunch: string) => {
    const directory = mkdtempSync(join(tmpdir(), "mirador-environment-commands-"));
    const profile = profileWith(environment);
    const harness = new HarnessProcess(
      {
        id: "opencode",
        label: "opencode (gateway)",
        logName: "gateway",
        command: [process.execPath, "-e", "process.stdin.resume()"],
        environment: ownEnvironment(),
        readEnvironment: async (signal) => {
          await readCommandValues(profile, ownEnvironment(), signal);
          return { ...ownEnvironment(), ...commandValues(profile) };
        },
        prelaunch,
        startsOneAtATime: false,
      },
      { onSessionUpdate: () => {}, onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } }) as never, onElicitationRequest: async () => ({ action: "cancel" }), onExit: () => {} },
      directory,
    );
    return harness;
  };

  test("runs its pre-launch command with their values", async () => {
    await expect(harnessReading("TOKEN=$(echo sk-printed)", 'echo "token is $TOKEN"; exit 3').start()).rejects.toThrow("token is sk-printed");
  });

  test("does not start when one fails", async () => {
    await expect(harnessReading("TOKEN=$(exit 4)", "").start()).rejects.toThrow('The command that gives profile "gateway" its TOKEN exited with 4');
  });

  test("stops while one runs", async () => {
    const harness = harnessReading("TOKEN=$(sleep 30; echo late)", "");
    const started = harness.start();
    const failure = started.catch((error: Error) => error.message);
    await Bun.sleep(200);
    await harness.stop();
    expect(await failure).toContain("stopped");
  }, 10_000);
});
