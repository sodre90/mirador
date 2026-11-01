import { expect, test } from "bun:test";
import { SignInCodes } from "../host/sign-in-codes.ts";
import { Store } from "../host/store.ts";

const clock = { now: 1_000_000 };
const signInCodes = () => new SignInCodes(new Store(":memory:"), () => clock.now);

test("a sign-in code works once", () => {
  const codes = signInCodes();
  const code = codes.mint();
  expect(codes.redeem(code)).toBe(true);
  expect(codes.redeem(code)).toBe(false);
  expect(codes.redeem("made-up")).toBe(false);
});

test("a sign-in code stops working after 10 minutes", () => {
  const codes = signInCodes();
  const inTime = codes.mint();
  const late = codes.mint();
  clock.now += 10 * 60_000 - 1;
  expect(codes.redeem(inTime)).toBe(true);
  clock.now += 1;
  expect(codes.redeem(late)).toBe(false);
});
