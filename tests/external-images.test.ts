import { describe, expect, test } from "bun:test";
import { isFromAnotherSite, siteOf } from "../web/external-images.ts";

const page = "https://mirador.example:4600";

describe("isFromAnotherSite", () => {
  test("an image on another site is, whatever form its address takes", () => {
    expect(isFromAnotherSite("https://images.invalid/a.png", page)).toBe(true);
    expect(isFromAnotherSite("http://images.invalid/a.png", page)).toBe(true);
    expect(isFromAnotherSite("//images.invalid/a.png", page)).toBe(true);
    expect(isFromAnotherSite("HTTPS://IMAGES.INVALID/a.png", page)).toBe(true);
  });

  test("the same host on another port or scheme is another site", () => {
    expect(isFromAnotherSite("https://mirador.example:4601/a.png", page)).toBe(true);
    expect(isFromAnotherSite("http://mirador.example:4600/a.png", page)).toBe(true);
  });

  test("the page's own images, and images carried in the reply itself, are not", () => {
    expect(isFromAnotherSite("/conversations/c1/images/i1.png", page)).toBe(false);
    expect(isFromAnotherSite("images/a.png", page)).toBe(false);
    expect(isFromAnotherSite("https://mirador.example:4600/a.png", page)).toBe(false);
    expect(isFromAnotherSite("data:image/png;base64,iVBORw0KGgo=", page)).toBe(false);
    expect(isFromAnotherSite("blob:https://mirador.example:4600/0b8f", page)).toBe(false);
    expect(isFromAnotherSite("", page)).toBe(false);
  });
});

describe("siteOf", () => {
  test("names the host an image comes from", () => {
    expect(siteOf("https://img.shields.io/badge/build-passing-green", page)).toBe("img.shields.io");
    expect(siteOf("//images.invalid:8443/a.png", page)).toBe("images.invalid");
  });
});
