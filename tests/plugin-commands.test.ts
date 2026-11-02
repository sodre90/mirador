import { describe, expect, test } from "bun:test";
import { appOpenCommandName, fileToOpen, pluginSlashCommands } from "../shared/plugin-commands.ts";

const words = { openApp: (title: string) => `Open ${title}`, fileHint: "<file>" };
const app = (name: string, title: string) => ({ name, title, viewPath: `/apps/${name}/view.js` });

describe("plugin slash commands", () => {
  test("each installed app opens with /<app>:open, before the plugins' tools, and wins a tool of the same name", () => {
    const tools = [
      { name: "counter:open", description: "A tool named open", hint: null },
      { name: "board:pin", description: "Pin", hint: null },
    ];
    expect(pluginSlashCommands([app("counter", "Counter")], tools, words)).toEqual([
      { name: "counter:open", description: "Open Counter", hint: "<file>" },
      { name: "board:pin", description: "Pin", hint: null },
    ]);
    expect(appOpenCommandName({ name: "counter" })).toBe("counter:open");
  });

  test("the file to open is the rest of the line, without an @ the path menu put before it", () => {
    expect(fileToOpen(" @plans/my flat.json ")).toBe("plans/my flat.json");
    expect(fileToOpen("")).toBe("");
  });
});
