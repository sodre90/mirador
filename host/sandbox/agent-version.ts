import type { Profile } from "../../shared/model.ts";
import { runsInSandbox, type SandboxedHarness } from "../../shared/sandbox.ts";
import { versionOf } from "../acp/claude-program.ts";
import { launchEnvironment } from "../acp/harnesses.ts";
import { installedPiVersion } from "../pi-updates.ts";
import type { AgentImage } from "./image.ts";

/** `2.1.330 (Claude Code)` as Claude Code says its version, or `1.6.0` as pi does; null for anything else. */
export const versionSaidIn = (said: string | null) => /^\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\b/.exec(said ?? "")?.[1] ?? null;

/** The version of the agent program an agent with this environment runs on this computer, which its sandbox's image installs; null where it can't be told. */
export async function agentVersionIn(harness: SandboxedHarness, environment: Record<string, string>): Promise<string | null> {
  if (harness === "claude") return environment.CLAUDE_CODE_EXECUTABLE ? versionSaidIn(await versionOf(environment.CLAUDE_CODE_EXECUTABLE)) : null;
  if (!environment.PI_ACP_PI_COMMAND) return null;
  return versionSaidIn(await installedPiVersion(environment.PI_ACP_PI_COMMAND, { ...environment, PI_OFFLINE: "1" }).catch(() => null));
}

const environmentOf = (profile: Profile, claudeProgramSetting: string) => {
  try {
    return launchEnvironment(profile.harness, profile, claudeProgramSetting);
  } catch {
    return null;
  }
};

/** The images the agents of these profiles run in a sandbox, at the versions of their programs on this computer, each once. */
export async function agentImagesOf(profiles: Profile[], claudeProgramSetting: string): Promise<AgentImage[]> {
  const found = await Promise.all(
    profiles.map(async ({ harness, ...profile }) => {
      if (!runsInSandbox(harness)) return [];
      const environment = environmentOf({ harness, ...profile }, claudeProgramSetting);
      const version = environment && (await agentVersionIn(harness, environment));
      return version ? [{ harness, version }] : [];
    }),
  );
  return [...new Map(found.flat().map((image) => [`${image.harness}-${image.version}`, image])).values()];
}
