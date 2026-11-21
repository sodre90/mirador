import { expect, test } from "bun:test";
import { conversationCanvasToken } from "../host/canvas-token.ts";

test("each conversation's canvas token is its own, made from the host's canvas token, and none is the host's", () => {
  const ownersConversation = conversationCanvasToken("host-canvas-token", "owners-conversation");
  const roomConversation = conversationCanvasToken("host-canvas-token", "room-conversation");
  expect(ownersConversation).toBe(conversationCanvasToken("host-canvas-token", "owners-conversation"));
  expect(roomConversation).not.toBe(ownersConversation);
  expect([ownersConversation, roomConversation]).not.toContain("host-canvas-token");
  expect(conversationCanvasToken("another-host-token", "owners-conversation")).not.toBe(ownersConversation);
  expect(ownersConversation).toMatch(/^[\w-]{43}$/);
});
