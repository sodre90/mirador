import { storedChoice } from "./stored-choice.ts";
import { t } from "./i18n/index.ts";

export type WorkspaceColorStyle = "card" | "heading" | "stripe";

export const workspaceColorStyleLabels: Record<WorkspaceColorStyle, string> = t.labels.workspaceColorStyle;

const workspaceColorStyle = storedChoice<WorkspaceColorStyle>("mirador-workspace-colors", ["card", "heading", "stripe"], "card");

/** The stylesheet colours a workspace's card, heading or edge by the root element's data-workspace-colors. */
export function applyWorkspaceColorStyle() {
  document.documentElement.dataset.workspaceColors = workspaceColorStyle.get();
}

export function setWorkspaceColorStyle(style: WorkspaceColorStyle) {
  workspaceColorStyle.set(style);
  applyWorkspaceColorStyle();
}

export const useWorkspaceColorStyle = workspaceColorStyle.use;
