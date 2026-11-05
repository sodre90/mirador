import { harnessLabels, type HarnessId } from "./model.ts";

const wordsOf = (text: string) => ` ${text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ")} `;

/** The agent to show beside a conversation's profile, or null when the profile's name already says it; a deleted or missing profile names none. */
export function agentBesideProfile(profileName: string | null, harness: HarnessId): string | null {
  const agent = harnessLabels[harness];
  if (profileName === null) return agent;
  const nameWords = wordsOf(profileName);
  return [agent, harness].some((agentName) => nameWords.includes(wordsOf(agentName))) ? null : agent;
}
