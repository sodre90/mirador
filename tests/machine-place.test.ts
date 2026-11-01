import { expect, test } from "bun:test";
import { placeIn } from "../web/machine-place.ts";

const placeMessage = (hash: unknown) => ({ type: "mirador:machine-place", hash });

test("a machine's page can tell the rail it shows a conversation, or none", () => {
  expect(placeIn(placeMessage("#/c/3f2a9c1e-7b4d-4e8a-9f00-1c2d3e4f5a6b"))).toBe("#/c/3f2a9c1e-7b4d-4e8a-9f00-1c2d3e4f5a6b");
  expect(placeIn(placeMessage(""))).toBe("");
});

test("anything else a machine's page sends is no place to come back to", () => {
  for (const hash of ["#/m/x", "#/c/../x", "javascript:alert(1)", "#/c/", "https://elsewhere.example/#/c/x", 7, null]) expect(placeIn(placeMessage(hash))).toBeNull();
  expect(placeIn({ type: "mirador:other", hash: "#/c/x" })).toBeNull();
  for (const data of ["#/c/x", null, undefined, 42]) expect(placeIn(data)).toBeNull();
});
