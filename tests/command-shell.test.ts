import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandLine, commandShell, findGitBash, findPowerShell, isConsoleTitleOf, powershellInvocation, programName, terminalShell, windowsPidOf } from "../host/command-shell.ts";

const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
const withGitBash = { gitBash: () => gitBash, powershell: () => "pwsh.exe" };
const withoutGitBash = { gitBash: () => null, powershell: () => "powershell.exe" };
const powershell = (program: string) => (command: string) => commandLine({ kind: "powershell", program }, command);

describe("a command string", () => {
  test("runs on the Mac and Linux in the shell its caller names, a login shell when asked", () => {
    expect(commandLine(commandShell(() => "/bin/zsh", {}, { platform: "darwin" }), "ls", { login: true })).toEqual(["/bin/zsh", "-lc", "ls"]);
    expect(commandLine(commandShell(() => "sh", {}, { platform: "linux" }), "ls")).toEqual(["sh", "-c", "ls"]);
  });

  test("runs on Windows in Git Bash, as Claude Code runs it, without asking for a Unix shell", () => {
    const noUnixShell = () => {
      throw new Error("process.getuid is not a function");
    };
    expect(commandLine(commandShell(noUnixShell, {}, { platform: "win32", windows: withGitBash }), "ls", { login: true })).toEqual([gitBash, "-lc", "ls"]);
    expect(commandLine(commandShell(noUnixShell, {}, { platform: "win32", windows: withGitBash }), "ls")).toEqual([gitBash, "-c", "ls"]);
  });

  test("runs on Windows without Git Bash in PowerShell, keeping the command's own exit code, and reads the profile only for a login", () => {
    const shell = commandShell(() => "sh", {}, { platform: "win32", windows: withoutGitBash });
    expect(shell).toEqual({ kind: "powershell", program: "powershell.exe" });
    const [program, ...args] = powershell("powershell.exe")("cmd /c exit 3");
    expect(program).toBe("powershell.exe");
    expect(args.slice(0, -1)).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]);
    expect(args.at(-1)).toContain("cmd /c exit 3\nif (-not $?) { exit $(if ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }) }");
    expect(commandLine(shell, "ls", { login: true })).not.toContain("-NoProfile");
  });

  test("runs on Windows in the Git Bash its own environment names, as the agent started with it finds it, not the host's", () => {
    const bash = join(mkdtempSync(join(tmpdir(), "mirador-git-bash-")), "bash");
    writeFileSync(bash, "");
    expect(process.env.CLAUDE_CODE_GIT_BASH_PATH).toBeUndefined();
    expect(commandShell(() => "sh", { CLAUDE_CODE_GIT_BASH_PATH: bash }, { platform: "win32" })).toEqual({ kind: "posix", program: bash });
  });
});

describe("Git Bash", () => {
  const existing = (...paths: string[]) => (path: string) => paths.includes(path);
  const noGit = () => null;

  test("is found where Claude Code looks: CLAUDE_CODE_GIT_BASH_PATH when it names a bash that exists", () => {
    const custom = "D:\\Tools\\Git\\bin\\bash.exe";
    expect(findGitBash({ CLAUDE_CODE_GIT_BASH_PATH: custom }, existing(custom, gitBash), noGit)).toBe(custom);
    expect(findGitBash({ CLAUDE_CODE_GIT_BASH_PATH: "D:\\Tools\\Git\\git-bash.exe" }, existing("D:\\Tools\\Git\\git-bash.exe", gitBash), noGit)).toBe(gitBash);
    expect(findGitBash({ CLAUDE_CODE_GIT_BASH_PATH: custom }, existing(gitBash), noGit)).toBe(gitBash);
  });

  test("is found next in Git's install folders, then beside the git on PATH", () => {
    const x86 = "C:\\Program Files (x86)\\Git\\bin\\bash.exe";
    expect(findGitBash({}, existing(x86), noGit)).toBe(x86);
    const scoop = "C:\\Users\\me\\scoop\\apps\\git\\current";
    expect(findGitBash({}, existing(`${scoop}\\bin\\bash.exe`), () => `${scoop}\\cmd\\git.exe`)).toBe(`${scoop}\\bin\\bash.exe`);
    expect(findGitBash({}, existing(`${scoop}\\bin\\bash.exe`), () => `${scoop}\\mingw64\\bin\\git.exe`)).toBe(`${scoop}\\bin\\bash.exe`);
    expect(findGitBash({}, existing(), noGit)).toBeNull();
  });
});

test("PowerShell 7 is preferred when installed, else Windows PowerShell", () => {
  expect(findPowerShell({}, (program) => (program === "pwsh" ? "C:\\Program Files\\PowerShell\\7\\pwsh.exe" : null))).toBe("C:\\Program Files\\PowerShell\\7\\pwsh.exe");
  expect(findPowerShell({}, (program) => (program === "powershell" ? "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" : null))).toBe(
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  expect(findPowerShell({}, () => null)).toBe("powershell.exe");
});

test("a program and its arguments reach PowerShell as they are, quotes included", () => {
  expect(powershellInvocation(["C:\\Program Files\\claude.exe", "auth", "it's"])).toBe("& 'C:\\Program Files\\claude.exe' 'auth' 'it''s'");
});

describe("a terminal tab", () => {
  test("runs the login shell as a login shell on the Mac and Linux, named after it", () => {
    const shell = terminalShell(() => "/bin/zsh", {}, { platform: "darwin" });
    expect(shell).toEqual(["/bin/zsh", "-l"]);
    expect(programName(shell[0]!)).toBe("zsh");
  });

  test("runs PowerShell on Windows, found in the tab's environment, without asking for a Unix shell, named without .exe", () => {
    const noUnixShell = () => {
      throw new Error("process.getuid is not a function");
    };
    const powershellOnPath = ({ PATH }: Record<string, string | undefined>) => `${PATH}\\pwsh.exe`;
    const shell = terminalShell(noUnixShell, { PATH: "C:\\Program Files\\PowerShell\\7" }, { platform: "win32", powershell: powershellOnPath });
    expect(shell).toEqual(["C:\\Program Files\\PowerShell\\7\\pwsh.exe", "-NoLogo"]);
    expect(programName(shell[0]!)).toBe("pwsh");
    expect(programName("powershell.exe")).toBe("powershell");
  });

  test("on Windows takes no title that only names the console's program, elevated or not, in any language", () => {
    const bash = "C:\\Program Files\\Git\\bin\\bash.exe";
    const pwsh = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
    expect(isConsoleTitleOf(bash, bash, "win32")).toBe(true);
    expect(isConsoleTitleOf(pwsh, `Administrator: ${pwsh}`, "win32")).toBe(true);
    expect(isConsoleTitleOf(pwsh, "Rendszergazda: C:\\PROGRAM FILES\\POWERSHELL\\7\\PWSH.EXE", "win32")).toBe(true);
    expect(isConsoleTitleOf("powershell.exe", "Windows PowerShell", "win32")).toBe(true);
    expect(isConsoleTitleOf("powershell.exe", "Administrator: Windows PowerShell", "win32")).toBe(true);
    expect(isConsoleTitleOf(pwsh, "Windows PowerShell", "win32")).toBe(false);
    expect(isConsoleTitleOf(pwsh, "my-title", "win32")).toBe(false);
    expect(isConsoleTitleOf(pwsh, "build: C:\\project", "win32")).toBe(false);
    expect(isConsoleTitleOf("/bin/zsh", "/bin/zsh", "darwin")).toBe(false);
  });
});

describe("a Git Bash pid", () => {
  const fakeGitBash = (script: string) => {
    const gitBash = join(mkdtempSync(join(tmpdir(), "fake-git-bash-")), "bash");
    writeFileSync(gitBash, `#!/bin/sh\n${script}`);
    chmodSync(gitBash, 0o755);
    return gitBash;
  };

  /** Its fake Git Bash is a shell script, which Windows does not run; there the last test asks the real one. */
  test.skipIf(process.platform === "win32")("becomes the Windows pid Git Bash knows behind it; one no MSYS process has, or one without Git Bash, stays", () => {
    const gitBash = fakeGitBash('[ "$2" = "cat /proc/495/winpid" ] && echo 10948 && exit 0\necho "cat: $2: No such file or directory" >&2; exit 1\n');
    expect(windowsPidOf(495, gitBash)).toBe(10948);
    expect(windowsPidOf(496, gitBash)).toBe(496);
    expect(windowsPidOf(495, null)).toBe(495);
  });

  test.skipIf(process.platform === "win32")("becomes the Windows pid it settles on, not the bash or nohup in between", () => {
    const reads = join(mkdtempSync(join(tmpdir(), "winpid-reads-")), "count");
    const gitBash = fakeGitBash(`echo x >> "${reads}"\n[ "$(wc -l < "${reads}")" -le 1 ] && echo 7001 || echo 7002\n`);
    expect(windowsPidOf(495, gitBash)).toBe(7002);
  });

  test.if(process.platform === "win32")("is the Windows pid of the job Git Bash started, read right after that Git Bash has exited", () => {
    const folder = mkdtempSync(join(tmpdir(), "git-bash-job-")).replaceAll("\\", "/");
    const job = `nohup "${process.execPath.replaceAll("\\", "/")}" -e "require('fs').writeFileSync('${folder}/windows-pid', String(process.pid)); setTimeout(() => {}, 10000)" > /dev/null 2>&1 & echo $!`;
    const started = Bun.spawnSync([findGitBash(process.env)!, "-c", job], { stdout: "pipe" });
    const gitBashPid = Number(started.stdout.toString().trim());
    const translated = windowsPidOf(gitBashPid);
    const deadline = Date.now() + 5_000;
    while (!existsSync(`${folder}/windows-pid`) && Date.now() < deadline) Bun.sleepSync(50);
    const windowsPid = Number(readFileSync(`${folder}/windows-pid`, "utf8"));
    process.kill(windowsPid);
    expect(gitBashPid).not.toBe(windowsPid);
    expect(translated).toBe(windowsPid);
  });
});
