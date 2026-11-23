import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RoomJoiner } from "../shared/rooms.ts";
import { WaitingToJoin } from "../web/RoomSettings.tsx";

const joiner: RoomJoiner = { roomId: "r1", personId: "p1", role: "guest", name: "Ivy", deviceName: "Member · Mirador on ivy-mac", since: 1 };

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'" };

/** The text of each element of the door list with the class, as the owner reads it. */
const textsOf = (markup: string, className: string) =>
  Array.from(markup.matchAll(new RegExp(`<(span|div) class="[^"]*\\b${className}\\b[^"]*"[^>]*>(.*?)</\\1>`, "g")), ([, , text]) => text!.replace(/&[#\w]+;/g, (entity) => ENTITIES[entity] ?? entity));

const doorList = (joiners: RoomJoiner[]) => renderToStaticMarkup(createElement(WaitingToJoin, { joiners }));

test("the door list shows each joiner's role apart from the device they came on, whose name it frames, so a device name can't pass for a role", () => {
  const markup = doorList([joiner]);
  expect(textsOf(markup, "room-joiner-role")).toEqual(["Guest"]);
  expect(textsOf(markup, "room-joiner-device")).toEqual(["from “Member · Mirador on ivy-mac”"]);
  expect(markup).not.toContain("Guest · Member");
});

test("the door list shows someone whose name reads as one already in the room without it, with the name they gave marked as the room marks a clash", () => {
  const markup = doorList([{ ...joiner, name: "", nameClash: "Alice" }]);
  expect(textsOf(markup, "room-joiner-name")).toEqual(["Someone without a name"]);
  expect(textsOf(markup, "room-person-name-clash")).toEqual(["Gave the name “Alice”, which reads as a name already in the room."]);
});
