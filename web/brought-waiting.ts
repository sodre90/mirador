import type { BroughtAgentHere } from "../shared/brought-agents.ts";
import type { Conversation } from "../shared/model.ts";
import { waitingTones } from "../shared/waiting.ts";
import type { AppState } from "./state.ts";

/** Whether the conversation's agent waits on your answer: to a tool it would use, or to a question. */
export const asksYou = ({ waitingFor }: Conversation) => waitingFor !== null && waitingTones[waitingFor] === "decision";

/** The key of a room of another machine in `roomsYourAgentsWaitIn`. */
export const joinedRoomKey = (machineId: string, roomId: string) => JSON.stringify([machineId, roomId]);

/** The rooms of other machines in which an agent you brought waits on you, by `joinedRoomKey`. */
export function roomsYourAgentsWaitIn({ broughtAgents, broughtConversations, broughtTasks }: Pick<AppState, "broughtAgents" | "broughtConversations" | "broughtTasks">): ReadonlySet<string> {
  const waits = ({ id, conversationId }: BroughtAgentHere) => {
    const conversation = broughtConversations.find((each) => each.id === conversationId);
    return broughtTasks.some(({ broughtId }) => broughtId === id) || (conversation !== undefined && asksYou(conversation));
  };
  return new Set(broughtAgents.filter(waits).map(({ machineId, roomId }) => joinedRoomKey(machineId, roomId)));
}

/** The conversations of agents you brought that wait on you, for lists of what does, which open them in their rooms. */
export const broughtWaitingOnYou = ({ broughtConversations }: Pick<AppState, "broughtConversations">) => broughtConversations.filter(asksYou);
