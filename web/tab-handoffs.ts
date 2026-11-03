/** What a plugin's workspace tab hands to the rest of the page: a conversation to start, or words for a composer. */

const START_CONVERSATION = "mirador-tab-start-conversation";
const ADD_TO_COMPOSER = "mirador-tab-add-to-composer";

interface ConversationToStart {
  workspaceId: string;
  prompt: string;
}

interface WordsForComposer {
  conversationId: string;
  text: string;
}

/** Throws when no listener took it, so the tab hears that nothing on the page could. */
const handOver = <Detail>(name: string, detail: Detail, nobodyTookIt: string) => {
  const taken = !window.dispatchEvent(new CustomEvent(name, { detail, cancelable: true }));
  if (!taken) throw new Error(nobodyTookIt);
};

export const startConversationFromTab = (workspaceId: string, prompt: string) => {
  if (!prompt.trim()) throw new Error("The message is empty.");
  handOver<ConversationToStart>(START_CONVERSATION, { workspaceId, prompt }, "Mirador can't start a conversation here.");
};

export const addToComposerFromTab = (conversationId: string, text: string) => {
  if (!text.trim()) throw new Error("There is nothing to add.");
  handOver<WordsForComposer>(ADD_TO_COMPOSER, { conversationId, text }, "The conversation's composer isn't open.");
};

/** `take` says whether it took the hand-off; the first to take it ends it. */
export const onConversationToStart = (take: (start: ConversationToStart) => boolean) => takeWhen(START_CONVERSATION, take);

export const onWordsForComposer = (take: (words: WordsForComposer) => boolean) => takeWhen(ADD_TO_COMPOSER, take);

function takeWhen<Detail>(name: string, take: (detail: Detail) => boolean) {
  const handle = (event: Event) => {
    if (!event.defaultPrevented && take((event as CustomEvent<Detail>).detail)) event.preventDefault();
  };
  window.addEventListener(name, handle);
  return () => window.removeEventListener(name, handle);
}
