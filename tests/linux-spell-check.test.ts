import { dlopen } from "bun:ffi";
import { expect, test } from "bun:test";

function canLoad(library: string, symbol: string) {
  try {
    dlopen(library, { [symbol]: { args: [], returns: "void" } }).close();
    return true;
  } catch {
    return false;
  }
}

const hasWebKitAndEnchant = process.platform === "linux" && canLoad("libwebkit2gtk-4.1.so.0", "webkit_get_major_version") && canLoad("libenchant-2.so.2", "enchant_broker_init");

test.skipIf(!hasWebKitAndEnchant)("the Linux helper compiles and lists dictionaries without libc's development files", async () => {
  const { linuxSpellChecker } = await import("../desktop/src/bun/linux-spell-check.ts");
  const checker = linuxSpellChecker();
  expect(checker).not.toBeNull();
  expect(Array.isArray(checker!.languages)).toBe(true);
});
