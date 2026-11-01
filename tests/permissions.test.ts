import { expect, test } from "bun:test";
import type { PermissionOption } from "@agentclientprotocol/sdk";
import { optionThatAllows } from "../host/conversations.ts";

const option = (optionId: string, kind: PermissionOption["kind"]): PermissionOption => ({ optionId, name: optionId, kind });

test("YOLO allows once when it can, always only when nothing else allows, and never picks a rejection", () => {
  expect(optionThatAllows([option("always", "allow_always"), option("once", "allow_once"), option("no", "reject_once")])).toBe("once");
  expect(optionThatAllows([option("no", "reject_once"), option("always", "allow_always")])).toBe("always");
  expect(optionThatAllows([option("no", "reject_once"), option("never", "reject_always")])).toBeNull();
});
