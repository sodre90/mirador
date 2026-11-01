/** A conversation is reached by its newest session alone: binding a newer session drops the mapping of every session it left behind. */
export class ConversationSessions {
  private readonly conversationBySession = new Map<string, string>();

  bind(conversationId: string, sessionId: string) {
    this.forget(conversationId);
    this.conversationBySession.set(sessionId, conversationId);
  }

  forget(conversationId: string) {
    [...this.conversationBySession]
      .filter(([, owner]) => owner === conversationId)
      .forEach(([sessionId]) => this.conversationBySession.delete(sessionId));
  }

  conversationOf(sessionId: string): string | undefined {
    return this.conversationBySession.get(sessionId);
  }
}
