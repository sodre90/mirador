import { expect, test } from "bun:test";
import { en } from "../web/i18n/en/index.ts";
import { removeMachineArmedHint } from "../web/machine-removal.ts";

const { hints } = en;

test("removing a machine says what stays there: this computer among the devices of one's own, the person in someone else's rooms, or nothing where this computer isn't signed in", () => {
  expect(removeMachineArmedHint({ joined: true, asPerson: false })).toBe(hints.removeMachineArmed);
  expect(removeMachineArmedHint({ joined: true, asPerson: true })).toBe(hints.removeSomeoneElsesMachineArmed);
  expect(removeMachineArmedHint({ joined: false, asPerson: true })).toBe(hints.removeMachineNotJoinedArmed);
  expect(removeMachineArmedHint({ joined: false, asPerson: false })).toBe(hints.removeMachineNotJoinedArmed);
});
