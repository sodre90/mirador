import { memo, useMemo, useState } from "react";
import type { AppDocumentState, InstalledApp, OpenApp } from "../shared/apps.ts";
import { latestPlan } from "../shared/timeline.ts";
import { CanvasPanel, CanvasShown } from "./Canvas.tsx";
import { changesRefreshPoint } from "./changes.ts";
import { editRequestsIn } from "./edit-approval.ts";
import { useEditsInCanvas } from "./edits-in-canvas.ts";
import type { OpenConversation, PluginTabState } from "./state.ts";
import type { WorkspacePluginTab } from "./WorkspaceTabView.tsx";

interface AppsState {
  openApps: OpenApp[];
  installedApps: InstalledApp[];
  appDocuments: Record<string, AppDocumentState>;
  workspaceTabs: Record<string, string>;
  pluginTabs: Record<string, Record<string, PluginTabState>>;
}

/** The plugins' tabs a workspace gets, once their host code said so. */
const tabsOfWorkspace = (titles: Record<string, string>, states: Record<string, PluginTabState> | undefined): WorkspacePluginTab[] =>
  Object.entries(titles).flatMap(([plugin, title]) => {
    const tab = states?.[plugin];
    return tab?.shown ? [{ plugin, title, state: tab.state, problem: tab.problem }] : [];
  });

/** The conversations whose canvas was shown, the one shown now included. */
function useShownOnce(shownId: string | null) {
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set(shownId ? [shownId] : []));
  if (shownId && !shown.has(shownId)) setShown(new Set(shown).add(shownId));
  return shown;
}

/**
 * The canvas of each kept conversation it was shown in, the others hidden but still live, so that switching back to a
 * conversation finds its pages and apps as they were instead of loading them again. `kept` is in a fixed order: moving a
 * page's frame in the document would load it again too.
 */
export function KeptCanvases({
  kept,
  shownId,
  workspaceOf,
  workingCopyOf,
  apps,
  assetsOrigin,
  homeDir,
  canvasViews,
  onHide,
}: {
  kept: OpenConversation[];
  shownId: string | null;
  workspaceOf: (conversationId: string) => string | undefined;
  workingCopyOf: (conversationId: string) => string | undefined;
  apps: AppsState;
  assetsOrigin: string;
  homeDir: string;
  canvasViews: Record<string, string>;
  onHide: () => void;
}) {
  const shownOnce = useShownOnce(shownId);
  const editsInCanvas = useEditsInCanvas();
  return kept
    .filter(({ conversationId }) => shownOnce.has(conversationId))
    .map((open) => (
      <KeptCanvas
        key={open.conversationId}
        open={open}
        shown={open.conversationId === shownId}
        workspaceId={workspaceOf(open.conversationId)}
        workingCopyId={workingCopyOf(open.conversationId)}
        apps={apps}
        editsInCanvas={editsInCanvas}
        assetsOrigin={assetsOrigin}
        homeDir={homeDir}
        canvasViews={canvasViews}
        onHide={onHide}
      />
    ));
}

const KeptCanvas = memo(function KeptCanvas({
  open,
  shown,
  workspaceId,
  workingCopyId,
  apps: { openApps, installedApps, appDocuments, workspaceTabs, pluginTabs },
  editsInCanvas,
  assetsOrigin,
  homeDir,
  canvasViews,
  onHide,
}: {
  open: OpenConversation;
  shown: boolean;
  workspaceId: string | undefined;
  workingCopyId: string | undefined;
  apps: AppsState;
  editsInCanvas: boolean;
  assetsOrigin: string;
  homeDir: string;
  canvasViews: Record<string, string>;
  onHide: () => void;
}) {
  const plan = useMemo(() => latestPlan(open.events), [open.events]);
  const edits = useMemo(() => (editsInCanvas ? editRequestsIn(open.events) : []), [open.events, editsInCanvas]);
  const refreshPoint = useMemo(() => changesRefreshPoint(open.events), [open.events]);
  const workspaceApps = useMemo(
    () => {
      const inFolder = openApps.filter((app) => app.workspaceId === workingCopyId);
      const here = inFolder.filter((app) => app.conversationId === open.conversationId);
      /** Only other conversations' documents, each once, and none this conversation shows already. */
      const heldHere = new Set(here.map((app) => app.documentId));
      const elsewhere = [...new Map(inFolder.filter((app) => app.conversationId !== open.conversationId && !heldHere.has(app.documentId)).map((app) => [app.documentId, app])).values()];
      return { open: here, elsewhere, installed: installedApps, documents: appDocuments };
    },
    [openApps, installedApps, appDocuments, workingCopyId, open.conversationId],
  );
  const workspaceStates = workspaceId ? pluginTabs[workspaceId] : undefined;
  const tabs = useMemo(() => tabsOfWorkspace(workspaceTabs, workspaceStates), [workspaceTabs, workspaceStates]);
  return (
    <div className="kept-canvas" style={{ display: shown ? "contents" : "none" }}>
      <CanvasShown.Provider value={shown}>
        <CanvasPanel
          conversationId={open.conversationId}
          items={open.canvas}
          plan={plan}
          edits={edits}
          assetsOrigin={assetsOrigin}
          homeDir={homeDir}
          changesRefreshPoint={refreshPoint}
          apps={workspaceApps}
          workspaceTabs={tabs}
          workspaceId={workspaceId}
          canvasViews={canvasViews}
          onHide={onHide}
        />
      </CanvasShown.Provider>
    </div>
  );
});
