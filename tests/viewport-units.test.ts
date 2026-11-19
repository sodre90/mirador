import { describe, expect, test } from "bun:test";
import { viewportUnitsFromFrame } from "../shared/viewport-units.ts";

const VH = "var(--mirador-vh)";
const VW = "var(--mirador-vw)";
const vh = (amount: string) => `calc(${amount} * ${VH})`;
const vw = (amount: string) => `calc(${amount} * ${VW})`;

describe("viewportUnitsFromFrame", () => {
  test("has viewport lengths in style blocks read the frame's units", () => {
    expect(viewportUnitsFromFrame("<style>#screen { height: 100vh; width: 50vw }</style>")).toBe(`<style>#screen { height: ${vh("100")}; width: ${vw("50")} }</style>`);
  });

  test("and in style attributes, double or single quoted", () => {
    expect(viewportUnitsFromFrame(`<div id="a" style="height:100vh">x</div><p style='min-width: 30vw'>y</p>`)).toBe(
      `<div id="a" style="height:${vh("100")}">x</div><p style='min-width: ${vw("30")}'>y</p>`,
    );
  });

  test("takes every viewport unit, in any case, the dynamic, small and large ones as the plain ones", () => {
    const heights = ["vh", "dvh", "svh", "lvh", "VH"];
    const widths = ["vw", "dvw", "svw", "lvw"];
    for (const unit of heights) expect(viewportUnitsFromFrame(`<style>a{height:10${unit}}</style>`)).toBe(`<style>a{height:${vh("10")}}</style>`);
    for (const unit of widths) expect(viewportUnitsFromFrame(`<style>a{width:10${unit}}</style>`)).toBe(`<style>a{width:${vw("10")}}</style>`);
    for (const unit of ["vmin", "dvmin"]) expect(viewportUnitsFromFrame(`<style>a{width:10${unit}}</style>`)).toBe(`<style>a{width:calc(10 * min(${VW}, ${VH}))}</style>`);
    for (const unit of ["vmax", "svmax"]) expect(viewportUnitsFromFrame(`<style>a{width:10${unit}}</style>`)).toBe(`<style>a{width:calc(10 * max(${VW}, ${VH}))}</style>`);
  });

  test("keeps negative and fractional lengths whole, inside calc and other functions", () => {
    expect(viewportUnitsFromFrame("<style>a{margin:-50vh 0 .5vw 1.5vh;height:calc(100vh - 2rem);width:clamp(10px, 40vw, 600px)}</style>")).toBe(
      `<style>a{margin:${vh("-50")} 0 ${vw(".5")} ${vh("1.5")};height:calc(${vh("100")} - 2rem);width:clamp(10px, ${vw("40")}, 600px)}</style>`,
    );
  });

  test("changes custom properties, so the var() reading them gets the frame's length", () => {
    expect(viewportUnitsFromFrame("<style>:root{--panel:100vh}</style>")).toBe(`<style>:root{--panel:${vh("100")}}</style>`);
  });

  test("leaves @media and @supports preludes alone, where a var() would break the rule, but changes the declarations inside", () => {
    const css = "@media (max-width: 50vw) and (min-height:20vh) { a { height: 100vh } } @supports (height: 100dvh) { b { height: 100dvh } }";
    expect(viewportUnitsFromFrame(`<style>${css}</style>`)).toBe(
      `<style>@media (max-width: 50vw) and (min-height:20vh) { a { height: ${vh("100")} } } @supports (height: 100dvh) { b { height: ${vh("100")} } }</style>`,
    );
  });

  test("leaves selectors alone, also nested ones and ones following a rule", () => {
    const css = "a:hover{height:10vh} .w-100vw{width:100vw} .a{color:red; b:nth-child(2) > c { height: 20vh } top: 5vh}";
    expect(viewportUnitsFromFrame(`<style>${css}</style>`)).toBe(
      `<style>a:hover{height:${vh("10")}} .w-100vw{width:${vw("100")}} .a{color:red; b:nth-child(2) > c { height: ${vh("20")} } top: ${vh("5")}}</style>`,
    );
  });

  test("leaves quoted strings and urls alone", () => {
    expect(viewportUnitsFromFrame(`<style>a::after{content:"100vh";background:url(100vh.png)}</style>`)).toBe(`<style>a::after{content:"100vh";background:url(100vh.png)}</style>`);
  });

  test("leaves page text alone, as a code sample escaping its tags", () => {
    const sample = `<pre><code>&lt;div style="height: 100vh"&gt;</code></pre><p>Use height: 100vh; for a full screen.</p>`;
    expect(viewportUnitsFromFrame(sample)).toBe(sample);
  });

  test("changes lengths in markup a script writes, which stays valid script", () => {
    const script = "<script>panel.innerHTML = `<div style=\"height:100vh\">${title}</div>`;</script>";
    expect(viewportUnitsFromFrame(script)).toBe(`<script>panel.innerHTML = \`<div style="height:${vh("100")}">\${title}</div>\`;</script>`);
  });

  test("leaves lengths in other units and attributes other than style alone", () => {
    const html = `<style>a{height:100px;width:50%;font-size:2rem}</style><div data-style="height:100vh" title="100vh">x</div>`;
    expect(viewportUnitsFromFrame(html)).toBe(html);
  });
});
