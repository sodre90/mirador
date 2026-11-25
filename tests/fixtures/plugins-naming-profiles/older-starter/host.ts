type Asked = { profile: string; choices?: true };

/** A tab that names the profile it starts a conversation on, or asks the choices of, as plugins did before API 23. */
export default {
  items: {},
  tools: {},
  workspaceTab: {
    state: ({ profiles }: { profiles(): { name: string }[] }) => ({ profiles: profiles().map(({ name }) => name) }),
    action: ({ profile, choices }: Asked, context: { startConversation(start: object): Promise<unknown>; profileChoices(profile: string): Promise<unknown> }) =>
      choices ? context.profileChoices(profile) : context.startConversation({ profile, prompt: "Check the older results", title: "Older results" }),
  },
};
