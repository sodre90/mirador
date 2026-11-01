import { expect, test } from "bun:test";
import { choseOpen, notifySendArguments } from "../host/notify-send.ts";

test("notify-send shows the notification with an Open button and waits for the user's choice", () => {
  expect(notifySendArguments({ kind: "join-request", title: "Phone asks to join Mirador", workspace: "", body: "From 10.0.0.7." })).toEqual([
    "--app-name=Mirador",
    "--action=open=Open Mirador",
    "--wait",
    "--",
    "Phone asks to join Mirador",
    "From 10.0.0.7.",
  ]);
  expect(notifySendArguments({ kind: "finished", title: "--help", workspace: "app", body: "Done" }).slice(-2)).toEqual(["--help", "app · Done"]);
});

test("only the Open button opens Mirador; closing the notification does not", () => {
  expect(choseOpen("open\n")).toBe(true);
  expect(choseOpen("")).toBe(false);
  expect(choseOpen("2\n")).toBe(false);
});
