import type { PlanEntry } from "@agentclientprotocol/sdk";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CanvasItem, PluginCanvasItem } from "../shared/model.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";

const AGENT_EDIT_FLASH_MS = 2000;

/** What the checklist tab shows above the agent's plan: a plugin's item that goes in the tab, such as the agent's checklist. */
export type TabItem = PluginCanvasItem & { placement: "tab" };

export const isTabItem = (item: CanvasItem): item is TabItem => item.kind === "plugin" && item.placement === "tab";

/** The tab's item is the newest the agent published there and the user has not dismissed; a new publishing brings one back. */
export const currentTabItem = (items: CanvasItem[]): TabItem | undefined => {
  const newest = items.filter(isTabItem).sort((a, b) => b.createdAt - a.createdAt)[0];
  return newest && !newest.dismissed ? newest : undefined;
};

const planProgress = (plan: PlanEntry[]) => `${plan.filter((entry) => entry.status === "completed").length}/${plan.length}`;

/** What the tab's toggle counts: its item's own count, or without one, the agent's plan. */
export const tabCount = (item: TabItem | undefined, plan: PlanEntry[] | null) => item?.count ?? planProgress(plan ?? []);

/**
 * Flashes for a moment when the agent changes the tab's item, though not for the change it carried when it came: the panel
 * opens before the conversation's history arrives, and an item arriving with it was changed long ago.
 */
export function useFlashOnAgentEdit(itemId: string | undefined, at: number | undefined, wanted: boolean) {
  const [flashing, setFlashing] = useState(false);
  const known = useRef({ itemId, at });
  useEffect(() => {
    const changedSince = known.current.itemId === itemId && at !== undefined && at !== known.current.at;
    known.current = { itemId, at };
    if (!changedSince || !wanted) return;
    setFlashing(true);
    const timer = setTimeout(() => setFlashing(false), AGENT_EDIT_FLASH_MS);
    return () => {
      clearTimeout(timer);
      setFlashing(false);
    };
  }, [itemId, at]);
  return flashing;
}

function PinnedPlan({ plan }: { plan: PlanEntry[] }) {
  return (
    <section className="checklist-section checklist-plan" aria-label={t.canvas.checklist.agentsPlan}>
      <h4 data-hint={hints.checklistPlan}>
        {t.canvas.checklist.agentsPlan} <span className="checklist-progress">{planProgress(plan)}</span>
      </h4>
      <ul>
        {plan.map((entry, index) => (
          <li key={index} className={["checklist-item", entry.status === "completed" && "done", `plan-${entry.status}`].filter(Boolean).join(" ")}>
            <label>
              <input type="checkbox" checked={entry.status === "completed"} disabled />
              <span className="checklist-text">{entry.content}</span>
              {entry.status === "in_progress" && <span className="checklist-owner">{t.canvas.checklist.inProgress}</span>}
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Covers the canvas like Changes: the tab's item, drawn by its plugin, and under it the plan the agent keeps for itself. */
export function ChecklistView({ plan, children }: { plan: PlanEntry[] | null; children?: ReactNode }) {
  return (
    <div className="checklist">
      {children}
      {plan && <PinnedPlan plan={plan} />}
    </div>
  );
}
