import { describe, expect, test } from "bun:test";
import { currentPath, expandVariables, hostEnvironment, withFolders } from "../host/current-path.ts";

/** A PATH value as reg.exe prints it, written as stored: an entry naming a %variable% is left unexpanded. */
function registryPath(key: string) {
  const query = Bun.spawnSync(["reg.exe", "query", key, "/v", "Path"], { stdout: "pipe" });
  return query.stdout.toString().match(/^\s+Path\s+REG_\w+\s+(.*)$/im)?.[1] ?? "";
}

describe("the PATH programs are looked up on and started with", () => {
  test("keeps its own folders first, then adds the ones it lacks, each once whatever its case or closing backslash", () => {
    expect(withFolders("C:\\Windows;C:\\Tools\\", "c:\\windows\\;C:\\tools;C:\\New;;C:\\new\\")).toBe("C:\\Windows;C:\\Tools\\;C:\\New");
    expect(withFolders(undefined, "C:\\New")).toBe("C:\\New");
    expect(withFolders("C:\\Windows", "")).toBe("C:\\Windows");
  });

  test("a variable a PATH entry names is replaced by its value, and one without a value is left as written", () => {
    const values: Record<string, string> = { "IntelliJ IDEA": "C:\\IDEA\\bin", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" };
    expect(expandVariables("%IntelliJ IDEA%;%LOCALAPPDATA%\\Toolbox;%Unset%\\bin;C:\\100%", (name) => values[name])).toBe(
      "C:\\IDEA\\bin;C:\\Users\\me\\AppData\\Local\\Toolbox;%Unset%\\bin;C:\\100%",
    );
  });

  test("elsewhere than on Windows, it is the PATH the host started with", () => {
    expect(currentPath("/usr/bin:/bin", "darwin")).toBe("/usr/bin:/bin");
    expect(currentPath("/usr/bin:/bin", "linux")).toBe("/usr/bin:/bin");
  });

  test.if(process.platform === "win32")("on Windows it has every folder of the machine's and the user's PATH as Windows has them now", () => {
    const registry = [registryPath("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"), registryPath("HKCU\\Environment")];
    const folders = registry.join(";").split(";").filter((folder) => folder && !folder.includes("%"));
    const path = currentPath()!.toLowerCase().split(";");
    expect(folders.length).toBeGreaterThan(0);
    expect(folders.filter((folder) => !path.includes(folder.toLowerCase()) && !path.includes(folder.toLowerCase().replace(/\\+$/, "")))).toEqual([]);
    expect(Object.keys(hostEnvironment()).filter((name) => name.toUpperCase() === "PATH")).toEqual(["PATH"]);
  });
});
