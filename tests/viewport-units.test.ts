import { describe, expect, test } from "bun:test";
import { viewportUnitsUnzoomed } from "../shared/viewport-units.ts";

const unzoomed = (length: string) => `calc(${length} / var(--mirador-zoom, 1))`;

describe("viewportUnitsUnzoomed", () => {
  test("divides viewport lengths in style blocks by the zoom", () => {
    expect(viewportUnitsUnzoomed("<style>#screen { height: 100vh; width: 50vw }</style>")).toBe(
      `<style>#screen { height: ${unzoomed("100vh")}; width: ${unzoomed("50vw")} }</style>`,
    );
  });

  test("divides them in style attributes, double or single quoted", () => {
    expect(viewportUnitsUnzoomed(`<div id="a" style="height:100vh">x</div><p style='min-width: 30vmin'>y</p>`)).toBe(
      `<div id="a" style="height:${unzoomed("100vh")}">x</div><p style='min-width: ${unzoomed("30vmin")}'>y</p>`,
    );
  });

  test("takes every viewport unit, in any case", () => {
    const units = ["vh", "vw", "vmin", "vmax", "dvh", "svh", "lvh", "dvw", "svw", "lvw", "dvmin", "svmax", "VH"];
    for (const unit of units) {
      expect(viewportUnitsUnzoomed(`<style>a{height:10${unit}}</style>`)).toBe(`<style>a{height:${unzoomed(`10${unit}`)}}</style>`);
    }
  });

  test("keeps negative and fractional lengths whole, inside calc and other functions", () => {
    expect(viewportUnitsUnzoomed("<style>a{margin:-50vh 0 .5vw 1.5vh;height:calc(100vh - 2rem);width:clamp(10px, 40vw, 600px)}</style>")).toBe(
      `<style>a{margin:${unzoomed("-50vh")} 0 ${unzoomed(".5vw")} ${unzoomed("1.5vh")};height:calc(${unzoomed("100vh")} - 2rem);width:clamp(10px, ${unzoomed("40vw")}, 600px)}</style>`,
    );
  });

  test("divides custom properties, so the var() reading them gets the divided length", () => {
    expect(viewportUnitsUnzoomed("<style>:root{--panel:100vh}</style>")).toBe(`<style>:root{--panel:${unzoomed("100vh")}}</style>`);
  });

  test("leaves @media and @supports preludes alone, where a var() would break the rule, but divides the declarations inside", () => {
    const css = "@media (max-width: 50vw) and (min-height:20vh) { a { height: 100vh } } @supports (height: 100dvh) { b { height: 100dvh } }";
    expect(viewportUnitsUnzoomed(`<style>${css}</style>`)).toBe(
      `<style>@media (max-width: 50vw) and (min-height:20vh) { a { height: ${unzoomed("100vh")} } } @supports (height: 100dvh) { b { height: ${unzoomed("100dvh")} } }</style>`,
    );
  });

  test("leaves selectors alone, also nested ones and ones following a rule", () => {
    const css = "a:hover{height:10vh} .w-100vw{width:100vw} .a{color:red; b:nth-child(2) > c { height: 20vh } top: 5vh}";
    expect(viewportUnitsUnzoomed(`<style>${css}</style>`)).toBe(
      `<style>a:hover{height:${unzoomed("10vh")}} .w-100vw{width:${unzoomed("100vw")}} .a{color:red; b:nth-child(2) > c { height: ${unzoomed("20vh")} } top: ${unzoomed("5vh")}}</style>`,
    );
  });

  test("leaves quoted strings and urls alone", () => {
    expect(viewportUnitsUnzoomed(`<style>a::after{content:"100vh";background:url(100vh.png)}</style>`)).toBe(`<style>a::after{content:"100vh";background:url(100vh.png)}</style>`);
  });

  test("leaves page text alone, as a code sample escaping its tags", () => {
    const sample = `<pre><code>&lt;div style="height: 100vh"&gt;</code></pre><p>Use height: 100vh; for a full screen.</p>`;
    expect(viewportUnitsUnzoomed(sample)).toBe(sample);
  });

  test("divides lengths in markup a script writes, which stays valid script", () => {
    const script = "<script>panel.innerHTML = `<div style=\"height:100vh\">${title}</div>`;</script>";
    expect(viewportUnitsUnzoomed(script)).toBe(`<script>panel.innerHTML = \`<div style="height:${unzoomed("100vh")}">\${title}</div>\`;</script>`);
  });

  test("leaves lengths in other units and attributes other than style alone", () => {
    const html = `<style>a{height:100px;width:50%;font-size:2rem}</style><div data-style="height:100vh" title="100vh">x</div>`;
    expect(viewportUnitsUnzoomed(html)).toBe(html);
  });
});
