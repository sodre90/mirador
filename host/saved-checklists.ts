import type { CanvasItemBase, PluginCanvasItem } from "../shared/model.ts";

interface SavedChecklistItem {
  id: string;
  text: string;
  detail?: string;
  owner: "agent" | "user" | "both";
  done: boolean;
  heardDone: boolean;
}

/** A checklist as Mirador saved it before the checklist became a plugin. */
export interface SavedChecklist extends Omit<CanvasItemBase, "kind"> {
  kind: "checklist";
  checklist: {
    sections: { title?: string; items: SavedChecklistItem[] }[];
    agentEdit?: { at: number; items: string[] };
    dismissed?: boolean;
  };
}

/**
 * The checklist plugin's item for a checklist saved before it, which the plugin goes on changing as its own. Changed now,
 * so a device catching up on what changed since it last looked gets it too.
 */
export function pluginItemOfSavedChecklist({ checklist, kind: _, ...base }: SavedChecklist, now: number): PluginCanvasItem {
  const items = checklist.sections.flatMap((section) => section.items);
  return {
    ...base,
    kind: "plugin",
    plugin: "checklist",
    type: "checklist",
    icon: "☑",
    placement: "tab",
    count: `${items.filter((item) => item.done).length}/${items.length}`,
    data: { sections: checklist.sections, ...(checklist.agentEdit && { agentChanged: checklist.agentEdit.items }) },
    ...(checklist.dismissed && { dismissed: true }),
    ...(checklist.agentEdit && { agentEditedAt: checklist.agentEdit.at }),
    updatedAt: now,
  };
}
