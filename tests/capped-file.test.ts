import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bytesOfRegularFileFrom, lastBytesOfRegularFile, tailOfRegularFile, textOfRegularFile } from "../host/capped-file.ts";
import { RUNS_SANDBOXES } from "./sandbox-computer.ts";

const scratch = mkdtempSync(join(tmpdir(), "capped-file-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function expectNotRead(name: string) {
  expect(await tailOfRegularFile(join(scratch, name), 1_000)).toBeNull();
  expect(await textOfRegularFile(join(scratch, name), 1_000)).toBeNull();
  expect(await bytesOfRegularFileFrom(join(scratch, name), 0, 1_000)).toBeNull();
}

test("a file is read only where it is a regular file, its tail up to a bound", async () => {
  const regular = join(scratch, "transcript.jsonl");
  writeFileSync(regular, "first line\nsecond line\nthird line\n");
  mkdirSync(join(scratch, "folder.jsonl"));

  expect(await tailOfRegularFile(regular, 1_000)).toBe("first line\nsecond line\nthird line\n");
  expect(await tailOfRegularFile(regular, 11)).toBe("third line\n");
  expect(await textOfRegularFile(regular, 1_000)).toBe("first line\nsecond line\nthird line\n");
  expect(await textOfRegularFile(regular, 10)).toBeNull();
  for (const name of ["folder.jsonl", "missing.jsonl"]) await expectNotRead(name);
});

test("a regular file is read from a byte on, up to a bound, with its size", async () => {
  const regular = join(scratch, "growing.jsonl");
  writeFileSync(regular, "first line\nsecond line\n");
  const read = async (from: number, most: number) => {
    const found = await bytesOfRegularFileFrom(regular, from, most);
    return found && { text: found.bytes.toString("utf8"), size: found.size };
  };
  expect(await read(11, 1_000)).toEqual({ text: "second line\n", size: 23 });
  expect(await read(11, 6)).toEqual({ text: "second", size: 23 });
  expect(await read(23, 1_000)).toEqual({ text: "", size: 23 });
  expect(await read(40, 1_000)).toEqual({ text: "", size: 23 });
  expect((await lastBytesOfRegularFile(regular, 12))?.bytes.toString("utf8")).toBe("second line\n");
});

test.skipIf(!RUNS_SANDBOXES)("a file a sandbox could have written is read neither through a link nor from a pipe", async () => {
  const secret = join(scratch, "secret");
  writeFileSync(secret, "the Mac's own file\n");
  symlinkSync(secret, join(scratch, "link.jsonl"));
  Bun.spawnSync(["mkfifo", join(scratch, "pipe.jsonl")]);
  for (const name of ["link.jsonl", "pipe.jsonl"]) await expectNotRead(name);
});
