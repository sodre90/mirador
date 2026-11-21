import { describe, expect, test } from "bun:test";
import { linkAskedFor } from "../web/outside-links.ts";

describe("a link someone else's machine asks to open", () => {
  const asked = (url: unknown) => linkAskedFor({ type: "mirador:open-link", url })?.href ?? null;

  test("is a web address, over HTTPS or plain HTTP", () => {
    expect(asked("https://example.com/garden?season=spring#beds")).toBe("https://example.com/garden?season=spring#beds");
    expect(asked("http://192.168.1.20:8080/")).toBe("http://192.168.1.20:8080/");
  });

  test("is never a file, a script, mail or any other scheme, nor anything that is not an address", () => {
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,<b>hi</b>", "mailto:ann@example.com", "blob:https://example.com/1", "ftp://example.com/", "/rooms", "example.com", "", 42, null]) {
      expect(asked(url)).toBeNull();
    }
  });

  test("is no longer than a link worth reading before it opens, and comes in the message the frames send", () => {
    expect(asked(`https://example.com/${"a".repeat(2000)}`)).not.toBeNull();
    expect(asked(`https://example.com/${"a".repeat(2100)}`)).toBeNull();
    expect(linkAskedFor({ type: "mirador:open", url: "https://example.com/" })).toBeNull();
    expect(linkAskedFor("https://example.com/")).toBeNull();
    expect(linkAskedFor(null)).toBeNull();
  });
});
