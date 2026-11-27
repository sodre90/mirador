import { expect, test } from "bun:test";
import { mountOf } from "./guard-told.ts";

test("a volume argument's source keeps a Windows drive, and only a last :ro makes it read-only", () => {
  expect(mountOf("/work/project:/mirador/raw/0")).toEqual({ source: "/work/project", target: "/mirador/raw/0", readOnly: false });
  expect(mountOf("/work/project:/mirador/raw/0:ro")).toEqual({ source: "/work/project", target: "/mirador/raw/0", readOnly: true });
  expect(mountOf("/work/ro:/mirador/ro")).toEqual({ source: "/work/ro", target: "/mirador/ro", readOnly: false });
  expect(mountOf("D:\\a\\mirador\\workspace:/mirador/raw/0")).toEqual({ source: "D:\\a\\mirador\\workspace", target: "/mirador/raw/0", readOnly: false });
  expect(mountOf("D:\\a\\mirador\\workspace:/mirador/raw/1:ro")).toEqual({ source: "D:\\a\\mirador\\workspace", target: "/mirador/raw/1", readOnly: true });
});

test("a folder of this computer mounted at its own path keeps its drive on both sides", () => {
  const folder = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\data\\sandbox\\room-1\\claude";
  expect(mountOf(`${folder}:${folder}`)).toEqual({ source: folder, target: folder, readOnly: false });
  expect(mountOf(`${folder}:${folder}:ro`)).toEqual({ source: folder, target: folder, readOnly: true });
  expect(mountOf("/home/me/.claude:/home/me/.claude")).toEqual({ source: "/home/me/.claude", target: "/home/me/.claude", readOnly: false });
});
