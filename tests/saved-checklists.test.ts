import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginItemOfSavedChecklist, type SavedChecklist } from "../host/saved-checklists.ts";
import { Store } from "../host/store.ts";
import type { CanvasItem, PluginCanvasItem } from "../shared/model.ts";
import { storeWithConversation } from "./canvas-plugin-host.ts";

const saved: SavedChecklist = {
  id: "saved-1",
  conversationId: "c1",
  kind: "checklist",
  title: "Release 0.4.2",
  status: "shown",
  createdAt: 5,
  updatedAt: 6,
  checklist: {
    sections: [
      {
        title: "Build",
        items: [
          { id: "tests", text: "Run the tests", owner: "agent", done: true, heardDone: true },
          { id: "build", text: "Build the app", owner: "user", done: false, heardDone: false },
        ],
      },
    ],
    agentEdit: { at: 6, items: ["tests"] },
    dismissed: true,
  },
};

describe("checklists saved before the checklist was a plugin", () => {
  test("become the plugin's items, as they were, changed now", () => {
    expect(pluginItemOfSavedChecklist(saved, 100)).toEqual({
      id: "saved-1",
      conversationId: "c1",
      kind: "plugin",
      plugin: "checklist",
      type: "checklist",
      icon: "☑",
      placement: "tab",
      count: "1/2",
      title: "Release 0.4.2",
      status: "shown",
      createdAt: 5,
      updatedAt: 100,
      data: { sections: saved.checklist.sections, agentChanged: ["tests"] },
      dismissed: true,
      agentEditedAt: 6,
    });
    const { agentEdit: _, dismissed: __, ...plain } = saved.checklist;
    expect(pluginItemOfSavedChecklist({ ...saved, checklist: plain }, 100)).not.toHaveProperty("dismissed");
  });

  test("are handed to the plugin when Mirador opens its database, once", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "saved-checklists-")), "state.sqlite");
    const before = storeWithConversation(path);
    before.saveCanvasItem({ ...saved, checklist: { ...saved.checklist, dismissed: false } } as unknown as CanvasItem);
    before.close();

    const opened = new Store(path);
    const [migrated] = opened.listCanvasItems("c1") as PluginCanvasItem[];
    expect(migrated).toMatchObject({ id: "saved-1", kind: "plugin", plugin: "checklist", count: "1/2" });
    opened.close();

    const openedAgain = new Store(path);
    expect(openedAgain.listCanvasItems("c1")).toEqual([migrated!]);
  });
});
