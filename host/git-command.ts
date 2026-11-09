import { HostProblemError } from "../shared/host-problems.ts";
import { environmentWithoutPrompts } from "./git-environment.ts";

/** git in `directory`, taking the paths it is given as they are, never as patterns. */
export async function git(directory: string, args: string[], input = "") {
  const child = Bun.spawn(["git", "-C", directory, ...args], {
    env: { ...environmentWithoutPrompts(), GIT_LITERAL_PATHSPECS: "1" },
    stdin: new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, output: stderr.trim() || stdout.trim(), exitCode };
}

/** git for the calls whose failure the user has to hear about, with what git said. */
export async function mustGit(directory: string, args: string[], input?: string) {
  const result = await git(directory, args, input);
  if (result.exitCode !== 0) throw new HostProblemError({ code: "git-failed", command: args[0]!, directory, output: result.output });
  return result.stdout;
}
