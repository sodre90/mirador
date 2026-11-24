import { useState } from "react";
import type { OpenApp } from "../shared/apps.ts";
import { latestCanvasArrival, latestCanvasNews } from "./canvas-news.ts";
import type { OpenConversation } from "./state.ts";

type ConversationCanvas = Pick<OpenConversation, "conversationId" | "canvas">;

/** The canvas of a conversation and that of the side chat beside it, which share the canvas pane. */
export interface CanvasPair {
  main: ConversationCanvas;
  side: ConversationCanvas;
  openApps: OpenApp[];
}

/** The canvas the user switched to, and the news on both when they did. */
export interface CanvasPick {
  sideChat: boolean;
  mainNews: string | undefined;
  sideNews: string | undefined;
}

const newsOn = ({ conversationId, canvas }: ConversationCanvas, openApps: OpenApp[]) => latestCanvasNews(canvas, openApps, conversationId);
const arrivalOn = ({ conversationId, canvas }: ConversationCanvas, openApps: OpenApp[]) => latestCanvasArrival(canvas, openApps, conversationId);

const waitingQuestions = ({ canvas }: ConversationCanvas) => canvas.filter(({ kind, status }) => kind === "ask" && status === "waiting");
export const questionWaitsOn = (canvas: ConversationCanvas) => waitingQuestions(canvas).length > 0;
const latestQuestionAt = (canvas: ConversationCanvas) => Math.max(...waitingQuestions(canvas).map(({ createdAt }) => createdAt));

/** Only a newer question of the main chat's agent takes a question of the side chat from under the user's answer. */
function sideChatComesForward({ main, side, openApps }: CanvasPair) {
  if (questionWaitsOn(side)) return latestQuestionAt(side) > latestQuestionAt(main);
  const news = newsOn(side, openApps);
  const isLatestThere = news !== undefined && news.at === arrivalOn(side, openApps)?.at;
  return isLatestThere && news.at > (arrivalOn(main, openApps)?.at ?? 0);
}

export const pickCanvas = ({ main, side, openApps }: CanvasPair, sideChat: boolean): CanvasPick => ({
  sideChat,
  mainNews: newsOn(main, openApps)?.key,
  sideNews: newsOn(side, openApps)?.key,
});

/** The main chat's canvas stays picked until there is news on the side chat's, and the side chat's until there is on either. */
function stillPicked(pick: CanvasPick, pair: CanvasPair) {
  const now = pickCanvas(pair, pick.sideChat);
  return now.sideNews === pick.sideNews && (!pick.sideChat || now.mainNews === pick.mainNews);
}

export const sideChatInFront = (pair: CanvasPair, pick: CanvasPick | undefined) => (pick && stillPicked(pick, pair) ? pick.sideChat : sideChatComesForward(pair));

/** Which of the two canvases the pane shows, and the user's switching between them, for as long as the page lives. */
export function useSideChatCanvas(main: ConversationCanvas | null, side: ConversationCanvas | null, openApps: OpenApp[]) {
  const [picks, setPicks] = useState<Record<string, CanvasPick>>({});
  if (!main || !side || !arrivalOn(side, openApps)) return null;
  const pair = { main, side, openApps };
  return {
    inFront: sideChatInFront(pair, picks[side.conversationId]),
    pick: (sideChat: boolean) => setPicks((current) => ({ ...current, [side.conversationId]: pickCanvas(pair, sideChat) })),
  };
}
