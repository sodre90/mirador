import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { accountShell, shellInUserRecord } from "../shared/login-shell.ts";

test("reads the shell from a getent passwd line or a dscl UserShell record", () => {
  expect(shellInUserRecord("dev:x:1000:1000:Dev User,,,:/home/dev:/usr/bin/fish\n")).toBe("/usr/bin/fish");
  expect(shellInUserRecord("UserShell: /bin/zsh\n")).toBe("/bin/zsh");
  expect(shellInUserRecord("")).toBeUndefined();
  expect(shellInUserRecord("No such key: UserShell")).toBeUndefined();
});

test.skipIf(process.platform === "win32")("finds this account's shell without $SHELL", () => {
  const shell = accountShell();
  expect(shell).toStartWith("/");
  expect(existsSync(shell!)).toBe(true);
});

test("a Windows account has no shell to find", () => {
  expect(accountShell("win32")).toBeUndefined();
});
