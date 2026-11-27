import type { AskItem, CanvasItem, HarnessId, Person, Profile } from "./model.ts";
import { personGoesBy } from "./people.ts";
import { agentStandIn, broughtAgentName, type Room } from "./rooms.ts";

/** Who made an item on a room's canvas, by the name and mark the room shows for them. */
export interface CanvasItemAuthor {
  name: string;
  harness?: HarnessId;
}

const isWaitingAsk = (item: CanvasItem): item is AskItem => item.kind === "ask" && item.status === "waiting";

/** Waiting questions on a room's canvas, oldest first so switcher pills keep their places as new ones arrive. */
export function waitingRoomAsks(items: CanvasItem[]): AskItem[] {
  return items.filter(isWaitingAsk).toSorted((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/**
 * Which item the canvas selects when a new one arrives: in a room, a waiting question already in front stays in front
 * rather than being yanked away by another agent's page or question.
 */
export function nextSelectionOnArrival(selectedId: string | null, items: CanvasItem[], onCanvasByDefault: string | null, inRoom: boolean): string | null {
  if (inRoom && selectedId !== null && items.some((item) => item.id === selectedId && isWaitingAsk(item))) return selectedId;
  return onCanvasByDefault;
}

/**
 * Which item the canvas shows once `settledId` is answered or withdrawn: in a room, the next waiting question if any
 * remain, rather than clearing to an empty canvas.
 */
export function nextSelectionAfterSettle(settledId: string, items: CanvasItem[], inRoom: boolean): string | null {
  if (!inRoom) return null;
  return waitingRoomAsks(items).find(({ id }) => id !== settledId)?.id ?? null;
}

/** Resolves which agent of `room` created a canvas item, by its conversation id or brought-agent stand-in. */
export function roomCanvasAuthorOf(room: Room, profiles: Profile[], people: Person[], nameless: string): (item: CanvasItem) => CanvasItemAuthor | null {
  const byConversation = new Map<string, CanvasItemAuthor>();
  for (const agent of room.agents) {
    const author: CanvasItemAuthor | null = agent.brought
      ? {
          name: broughtAgentName(personGoesBy(people.find(({ id }) => id === agent.brought!.personId), nameless), agent.brought.name),
          harness: agent.brought.harness,
        }
      : (() => {
          const profile = profiles.find(({ id }) => id === agent.profileId);
          return profile ? { name: profile.name, harness: profile.harness } : null;
        })();
    if (!author) continue;
    if (agent.conversationId) byConversation.set(agent.conversationId, author);
    byConversation.set(agentStandIn(room.id, agent.profileId), author);
  }
  return (item) => byConversation.get(item.conversationId) ?? null;
}
