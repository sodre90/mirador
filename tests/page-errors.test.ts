import { describe, expect, test } from "bun:test";
import { pageErrorMessage, pageErrorReporter } from "../web/page-errors.ts";

describe("page errors", () => {
  test("an error is sent with its name, message, stack and the components it was rendering", () => {
    const error = new TypeError("undefined is not an object");
    const message = pageErrorMessage(error, "\n    at Canvas\n    at App");
    expect(message.message).toBe("TypeError: undefined is not an object");
    expect(message.stack).toContain(error.stack!);
    expect(message.stack).toEndWith("component stack:\n    at Canvas\n    at App");
  });

  test("something thrown that is not an Error is sent as text, without a stack", () => {
    expect(pageErrorMessage("plain text")).toEqual({ type: "page.error", message: "plain text", stack: "" });
  });

  test("the same error goes to the host once, a different one goes too", () => {
    const sent: string[] = [];
    const report = pageErrorReporter((message) => sent.push(message.message));
    report(new Error("first"));
    report(new Error("first"));
    report(new Error("second"));
    expect(sent).toEqual(["Error: first", "Error: second"]);
  });
});
