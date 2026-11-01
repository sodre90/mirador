export interface CommandResult {
  exitCode: number;
  output: string;
}

export type CommandRunner = (argv: string[]) => Promise<CommandResult>;

export const runCommand: CommandRunner = async (argv) => {
  const child = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { exitCode, output: `${stdout}${stderr}`.trim() };
};
