import { useEffect, useRef, type Dispatch, type ReactNode, type RefObject } from "react";
import type { BroughtAgentHere, BroughtTaskWaiting } from "../shared/brought-agents.ts";
import type { Conversation, Profile, Workspace } from "../shared/model.ts";
import { BroughtTaskCard, isBusy, JumpToLatest, PendingApprovals, QueuedMessages, TimelineOfEvents, useScrollAnchor } from "./Chat.tsx";
import { connection } from "./connection.ts";
import { ConversationSettingsPopover, ConversationSettingsToggle, useConversationSettings } from "./ConversationSettings.tsx";
import { useEarlierHistory } from "./earlier-history.ts";
import { t } from "./i18n/index.ts";
import { asksYou } from "./brought-waiting.ts";
import { WorkspaceScopePill } from "./RoomWorkspace.tsx";
import type { AppAction, OpenConversation } from "./state.ts";

const words = t.rooms;

/** An agent you brought into the room shown, with the conversation it works in on your computer. */
export interface BroughtHere {
  conversation: Conversation;
  name: string;
  /** The local workspace name when it works in one of yours; null when it works in the room's workspace. */
  workspaceLabel: string | null;
  opened: OpenConversation | undefined;
  tasks: BroughtTaskWaiting[];
}

/** The agents you brought into this room of the machine, once each has a conversation of yours. */
export function broughtInto(
  machineId: string,
  roomId: string | null,
  {
    broughtAgents,
    broughtConversations,
    broughtWork,
    broughtTasks,
    profiles,
    workspaces = [],
  }: {
    broughtAgents: BroughtAgentHere[];
    broughtConversations: Conversation[];
    broughtWork: OpenConversation[];
    broughtTasks: BroughtTaskWaiting[];
    profiles: Profile[];
    workspaces?: Workspace[];
  },
): BroughtHere[] {
  return broughtAgents
    .filter((brought) => brought.machineId === machineId && brought.roomId === roomId)
    .flatMap(({ profileId, conversationId, workspaceId }) => {
      const conversation = broughtConversations.find(({ id }) => id === conversationId);
      if (!conversation) return [];
      const workspaceLabel = conversation.worksInRoomsWorkspace ? null : (workspaces.find(({ id }) => id === (workspaceId ?? conversation.workspaceId))?.name ?? null);
      return [
        {
          conversation,
          name: profiles.find(({ id }) => id === profileId)?.name ?? words.agentGone,
          workspaceLabel,
          opened: broughtWork.find((open) => open.conversationId === conversation.id),
          tasks: broughtTasks.filter((task) => task.conversationId === conversation.id),
        },
      ];
    });
}

/** Whether the agent waits on you: a task of someone else for your OK, or one of its tools or questions. */
export const waitsForYou = ({ conversation, tasks }: BroughtHere) => tasks.length > 0 || asksYou(conversation);

/** Keeps the conversations of the agents you brought into the room shown subscribed, so what they wait on and do shows. */
export function useBroughtWorkKept(here: BroughtHere[], dispatch: Dispatch<AppAction>) {
  const conversationIds = here.map(({ conversation }) => conversation.id).join(" ");
  useEffect(() => dispatch({ type: "keep-brought-work", conversationIds: conversationIds ? conversationIds.split(" ") : [] }), [conversationIds]);
}

/** In this computer's line above the room: each agent you brought, its model and the rest its agent offers, and its work. */
export function BroughtAgentsBar({ here, workShown, profiles, dispatch }: { here: BroughtHere[]; workShown: string | null; profiles: Profile[]; dispatch: Dispatch<AppAction> }) {
  if (here.length === 0) return null;
  return (
    <span className="brought-agents-bar" role="group" aria-label={words.yourAgentsHere}>
      {here.map((agent) => (
        <BroughtAgentControls key={agent.conversation.id} agent={agent} shown={workShown === agent.conversation.id} profiles={profiles} dispatch={dispatch} />
      ))}
    </span>
  );
}

const broughtHerePill = ({ conversation, workspaceLabel }: Pick<BroughtHere, "conversation" | "workspaceLabel">) => (
  <WorkspaceScopePill scope={conversation.worksInRoomsWorkspace ? "room" : "own"} label={conversation.worksInRoomsWorkspace ? words.workspaceScope.room : (workspaceLabel ?? words.workspaceScope.yourOwn)} />
);

function BroughtAgentControls({ agent, shown, profiles, dispatch }: { agent: BroughtHere; shown: boolean; profiles: Profile[]; dispatch: Dispatch<AppAction> }) {
  const settings = useConversationSettings();
  const { conversation, name } = agent;
  const waits = waitsForYou(agent);
  return (
    <span className="brought-agent-controls">
      <ConversationSettingsToggle conversation={conversation} profiles={profiles} settings={settings} />
      <ConversationSettingsPopover conversation={conversation} profiles={profiles} begun={true} settings={settings} title={words.settingsOf(name)} note={words.broughtSettingsNote} />
      {broughtHerePill(agent)}
      <button
        type="button"
        className={`link brought-work-toggle${waits ? " waits" : ""}`}
        aria-label={words.showWorkOf(name)}
        aria-pressed={shown}
        data-hint={waits ? words.waitsForYou(name) : words.showWorkOf(name)}
        onClick={() => dispatch({ type: "show-brought-work", conversationId: shown ? null : conversation.id })}
      >
        {words.itsWork}
      </button>
    </span>
  );
}

/** Under that line: the tasks of others and the requests of its tools your agents wait on you for, to answer without leaving the room. */
export function BroughtAgentsWaiting({ here }: { here: BroughtHere[] }) {
  const waiting = here.filter((agent) => agent.tasks.length > 0 || agent.opened?.loaded);
  if (waiting.length === 0) return null;
  return (
    <section className="brought-agents-waiting" aria-label={words.waitingForYouHere}>
      {waiting.map(({ conversation, name, opened, tasks }) => (
        <div key={conversation.id} className="brought-agent-waiting" data-brought-conversation={conversation.id}>
          {tasks.map((task) => (
            <BroughtTaskCard key={task.id} task={task} />
          ))}
          {opened?.loaded && <PendingApprovalsOf name={name} conversationId={conversation.id} opened={opened} />}
        </div>
      ))}
    </section>
  );
}

function PendingApprovalsOf({ name, conversationId, opened }: { name: string; conversationId: string; opened: OpenConversation }) {
  return (
    <div className="brought-agent-approvals" aria-label={words.waitsForYou(name)}>
      <PendingApprovals conversationId={conversationId} events={opened.events} />
    </div>
  );
}

/** A room message to scroll to inside Its work; `at` distinguishes repeated clicks on the same task. */
export interface BroughtWorkJump {
  messageSeq: number;
  at: number;
}

/** Beside the room, what an agent you brought did on its tasks there, read as its conversation shows it, and nothing to write to it with. */
export function BroughtWorkPanel({
  agent,
  jumpTo = null,
  resizer,
  onClose,
}: {
  agent: BroughtHere;
  jumpTo?: BroughtWorkJump | null;
  resizer?: ReactNode;
  onClose: () => void;
}) {
  const { conversation, name, opened } = agent;
  const panelRef = useRef<HTMLElement>(null);
  const { ref, onScroll, awayFromLatest, jumpToLatest } = useScrollAnchor();
  useEffect(() => {
    connection.send({ type: "conversation.set-unread", conversationId: conversation.id, unread: false });
  }, [conversation.id]);
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, [conversation.id]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <aside ref={panelRef} tabIndex={-1} className="side-chat brought-work" aria-label={words.workOf(name)} data-brought-work={conversation.id}>
      {resizer}
      <header className="side-chat-header">
        <div className="side-chat-heading">
          <h2>{words.workOf(name)}</h2>
          {broughtHerePill(agent)}
        </div>
        {isBusy(conversation) && (
          <button type="button" className="danger brought-work-stop" onClick={() => connection.send({ type: "conversation.cancel", conversationId: conversation.id })}>
            {t.chat.composer.stop}
          </button>
        )}
        <button type="button" className="icon" aria-label={words.closeWork} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="timeline" ref={ref} onScroll={onScroll}>
        {opened?.loaded ? <WorkSoFar conversation={conversation} name={name} opened={opened} jumpTo={jumpTo} container={ref} /> : <div className="notice-line">{words.loading}</div>}
      </div>
      {awayFromLatest && <JumpToLatest onJump={jumpToLatest} />}
      {conversation.queuedMessages.length > 0 && (
        <QueuedMessages
          conversationId={conversation.id}
          harness={conversation.harness}
          messages={conversation.queuedMessages}
          onRemove={(message) => connection.send({ type: "conversation.queue.remove", conversationId: conversation.id, messageId: message.id })}
        />
      )}
      <div className="brought-work-footer hint">{words.tagItInTheRoom}</div>
    </aside>
  );
}

function WorkSoFar({
  conversation,
  name,
  opened,
  jumpTo,
  container,
}: {
  conversation: Conversation;
  name: string;
  opened: OpenConversation;
  jumpTo: BroughtWorkJump | null;
  container: RefObject<HTMLDivElement | null>;
}) {
  const earlier = useEarlierHistory(opened);
  const jumpedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!jumpTo || jumpedAt.current === jumpTo.at) return;
    const target = container.current?.querySelector<HTMLElement>(`[data-room-message-seq="${jumpTo.messageSeq}"]`);
    if (target) {
      jumpedAt.current = jumpTo.at;
      target.scrollIntoView({ block: "start" });
      target.classList.remove("jumped");
      void target.offsetWidth;
      target.classList.add("jumped");
      return;
    }
    if (earlier.available && !earlier.loading) earlier.load();
  }, [jumpTo, opened.events.length, earlier.available, earlier.loading]);
  if (opened.events.length === 0) return <div className="notice-line">{words.noWorkYet}</div>;
  return (
    <>
      {earlier.available && (
        <button type="button" className="link brought-work-earlier" disabled={earlier.loading} onClick={() => earlier.load()}>
          {t.chat.timeline.showEarlier}
        </button>
      )}
      <TimelineOfEvents conversation={conversation} events={opened.events} agentName={name} onlyReads={false} />
    </>
  );
}
