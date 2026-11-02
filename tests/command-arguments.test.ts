import { describe, expect, test } from "bun:test";
import { argumentsHint, commandInput } from "../shared/command-arguments.ts";

const schema = {
  type: "object",
  properties: { title: { type: "string" }, size: { type: "number" }, loud: { type: "boolean" }, tags: { type: "array" }, note: {} },
  required: ["title"],
};

describe("a command's arguments", () => {
  test("the menu's hint names the required ones first, the rest in brackets, and nothing for a tool that takes none", () => {
    expect(argumentsHint(schema)).toBe("title=… [size=…] [loud=…] [tags=…] [note=…]");
    expect(argumentsHint({ type: "object", properties: {} })).toBeNull();
    expect(argumentsHint({ type: "object" })).toBeNull();
  });

  test("are key=value words, quoted where a value has spaces, each read as its property's type", () => {
    expect(commandInput(`title="Rex \\"the\\" dog"  size=3 loud=true tags='["a","b"]' note=12`, schema)).toEqual({
      title: 'Rex "the" dog',
      size: 3,
      loud: true,
      tags: ["a", "b"],
      note: "12",
    });
    expect(commandInput("title=3 size=big", schema), "a value the type can't read is left for the schema to refuse").toEqual({ title: "3", size: "big" });
    expect(commandInput("title= ", schema)).toEqual({ title: "" });
  });

  test("refuse a word that isn't key=value, a key the tool doesn't take, and a missing required one", () => {
    expect(() => commandInput("title=a stray", schema)).toThrow("not stray.");
    expect(() => commandInput(`title="a b"c`, schema)).toThrow("not c.");
    expect(() => commandInput("title=a colour=red", schema)).toThrow("The command takes title, size, loud, tags, note, not colour.");
    expect(() => commandInput("size=1", schema)).toThrow("The command needs title=….");
    expect(commandInput("", { type: "object" })).toEqual({});
  });
});
