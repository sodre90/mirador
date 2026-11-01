import { describe, expect, test } from "bun:test";
import { renameWhenFree } from "../host/rename-when-free.ts";

const failingWith = (code: string) => Object.assign(new Error(code), { code });

/** A rename that fails with `code` the first `times` times, then succeeds; counts its tries. */
function renameHeld(code: string, times: number) {
  const tries: string[] = [];
  const rename = (from: string, to: string) => {
    tries.push(`${from} -> ${to}`);
    if (tries.length <= times) throw failingWith(code);
  };
  return { rename, tries };
}

describe("renaming a folder another process still holds", () => {
  test("tries again until Windows lets it go", async () => {
    for (const code of ["EPERM", "EACCES", "EBUSY"]) {
      const { rename, tries } = renameHeld(code, 2);
      await renameWhenFree("staged", "plugin", rename);
      expect(tries).toEqual(["staged -> plugin", "staged -> plugin", "staged -> plugin"]);
    }
  });

  test("fails with Windows' error once the folder stays held past the wait", async () => {
    const { rename } = renameHeld("EPERM", Infinity);
    await expect(renameWhenFree("staged", "plugin", rename, 300)).rejects.toMatchObject({ code: "EPERM" });
  });

  test("fails at once for any other error", async () => {
    const { rename, tries } = renameHeld("ENOENT", Infinity);
    await expect(renameWhenFree("staged", "plugin", rename)).rejects.toMatchObject({ code: "ENOENT" });
    expect(tries).toHaveLength(1);
  });
});
