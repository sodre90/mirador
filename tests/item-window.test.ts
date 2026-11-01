import { describe, expect, test } from "bun:test";
import { itemWindowName, itemWindowRoute, itemWindowRouteOf, itemWindowTitle } from "../shared/item-window.ts";

describe("item window route", () => {
  test("names the conversation and the item, and reads back what it wrote", () => {
    const route = { conversationId: "c-1", itemId: "i/2 #3" };
    expect(itemWindowRoute(route)).toBe("#/item/c-1/i%2F2%20%233");
    expect(itemWindowRouteOf(itemWindowRoute(route))).toEqual(route);
  });

  test("is no item window's for any other address", () => {
    for (const hash of ["", "#/c/c-1", "#/item/c-1", "#/item//i-1", "#/item/c-1/i-1/more", "#/item/%E0%A4%A/i-1"]) {
      expect(itemWindowRouteOf(hash)).toBeNull();
    }
  });

  test("names the window by the item, and titles it the way window rules match it", () => {
    expect(itemWindowName("i-1")).toBe("mirador-item-i-1");
    expect(itemWindowTitle("Review of the parser")).toBe("Mirador: Review of the parser");
  });
});
