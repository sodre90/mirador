import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tailOfRegularFile, textOfRegularFile } from "../host/capped-file.ts";

const scratch = mkdtempSync(join(tmpdir(), "capped-file-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("a file a sandbox could have written is read only where it is a regular file, its tail up to a bound, never through a link, a pipe or a folder", async () => {
  const regular = join(scratch, "transcript.jsonl");
  writeFileSync(regular, "first line\nsecond line\nthird line\n");
  const secret = join(scratch, "secret");
  writeFileSync(secret, "the Mac's own file\n");
  symlinkSync(secret, join(scratch, "link.jsonl"));
  Bun.spawnSync(["mkfifo", join(scratch, "pipe.jsonl")]);
  mkdirSync(join(scratch, "folder.jsonl"));

  expect(await tailOfRegularFile(regular, 1_000)).toBe("first line\nsecond line\nthird line\n");
  expect(await tailOfRegularFile(regular, 11)).toBe("third line\n");
  expect(await textOfRegularFile(regular, 1_000)).toBe("first line\nsecond line\nthird line\n");
  expect(await textOfRegularFile(regular, 10)).toBeNull();
  for (const name of ["link.jsonl", "pipe.jsonl", "folder.jsonl", "missing.jsonl"]) {
    expect(await tailOfRegularFile(join(scratch, name), 1_000)).toBeNull();
    expect(await textOfRegularFile(join(scratch, name), 1_000)).toBeNull();
  }
});
