import { createHmac } from "node:crypto";

/**
 * What one conversation's agent calls its canvas server with: made from the host's canvas token and the conversation's
 * id, so that an agent holds no token another conversation's canvas server takes, even once it learns that one's id.
 */
export const conversationCanvasToken = (canvasToken: string, conversationId: string) => createHmac("sha256", canvasToken).update(conversationId).digest("base64url");
