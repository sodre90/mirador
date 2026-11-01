import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { copyNameOf, DroppedFiles, MAX_DROPPED_FILE_BYTES } from "../host/dropped-files.ts";
import { copyingPlaceholder, nonImagesDropped, pathToInsert, withPathOfCopy } from "../web/dropped-files.ts";

const conversationId = "0b6f2c1e-58d4-4a8e-9a43-4d2b8c6f0e11";
let directory: string;
let files: DroppedFiles;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "mirador-dropped-files-"));
  files = new DroppedFiles(directory);
});

afterEach(() => rm(directory, { recursive: true, force: true }));

test.skipIf(process.platform === "win32")("a dropped file's folder is open to its owner only", async () => {
  const path = await files.save(conversationId, "server.log", new Blob(["line one\n"]));
  expect((await stat(dirname(path))).mode & 0o777).toBe(0o700);
});

test("a dropped file is copied under its own name, in a folder of its own, and goes away with the conversation", async () => {
  const path = await files.save(conversationId, "server.log", new Blob(["line one\nline two\n"]));
  expect(basename(path)).toBe("server.log");
  expect(dirname(dirname(path))).toBe(join(directory, conversationId));
  expect(await Bun.file(path).text()).toBe("line one\nline two\n");

  const again = await files.save(conversationId, "server.log", new Blob(["a later copy"]));
  expect(again).not.toBe(path);
  expect(await Bun.file(path).text()).toBe("line one\nline two\n");

  files.deleteConversation(conversationId);
  expect(await readdir(directory)).toEqual([]);
});

test("a dropped file over the limit is refused and leaves nothing behind", async () => {
  const oversized = new Blob([new Uint8Array(MAX_DROPPED_FILE_BYTES + 1)]);
  await expect(files.save(conversationId, "huge.bin", oversized)).rejects.toThrow("A dropped file can be at most 100 MB.");
  expect(await readdir(directory)).toEqual([]);
});

test("a copy keeps the file's own name, but never a folder or a control character in it", () => {
  expect(copyNameOf("napló ő.txt")).toBe("napló ő.txt");
  expect(copyNameOf("../../.ssh/authorized_keys")).toBe("authorized_keys");
  expect(copyNameOf("C:\\Users\\me\\evil.txt")).toBe("evil.txt");
  expect(copyNameOf("bad\u0000name\n.log")).toBe("badname.log");
  expect([".", "..", "", "  "].map(copyNameOf)).toEqual([null, null, null, null]);
});

test("a file without a usable name, or of an unknown conversation, is not copied", async () => {
  await expect(files.save(conversationId, "..", new Blob(["x"]))).rejects.toThrow("A dropped file needs a name.");
  await expect(files.save("../elsewhere", "server.log", new Blob(["x"]))).rejects.toThrow("Unknown conversation.");
  expect(await readdir(directory)).toEqual([]);
});

test("the message box names the copy as one path, and holds each file's place with a placeholder of its own", () => {
  expect(pathToInsert("/Users/me/.mirador/dropped-files/c1/f1/server.log")).toBe("/Users/me/.mirador/dropped-files/c1/f1/server.log");
  expect(pathToInsert("/Users/me/.mirador/dropped-files/c1/f1/build output.log")).toBe('"/Users/me/.mirador/dropped-files/c1/f1/build output.log"');
  expect(copyingPlaceholder(1, "server.log")).not.toBe(copyingPlaceholder(2, "server.log"));
});

test("a file whose name has a dollar sign goes in under that very name", () => {
  for (const name of ["cost$$.log", "a$&b.log", "x$'y.log"]) {
    const placeholder = copyingPlaceholder(1, name);
    expect(withPathOfCopy(`see ${placeholder} now`, placeholder, `/copies/f1/${name}`)).toBe(`see /copies/f1/${name} now`);
  }
});

const dropped = (file: File, isDirectory = false) => ({ kind: "file", webkitGetAsEntry: () => ({ isDirectory, name: file.name }), getAsFile: () => file });

test("of a drop, images are left to go in as images, other files are copied, and folders are named as ones that can't go in", () => {
  const log = new File(["a line"], "server.log", { type: "text/plain" });
  const items = [dropped(new File(["png"], "shot.png", { type: "image/png" })), dropped(log), dropped(new File([], "logs"), true), { kind: "string", webkitGetAsEntry: () => null, getAsFile: () => null }];
  expect(nonImagesDropped({ items } as unknown as DataTransfer)).toEqual({ files: [log], folders: ["logs"] });
});
