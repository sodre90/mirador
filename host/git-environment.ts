/** Nobody is there to type a password or a key's passphrase, and a prompt would land in the terminal the host was started from. */
export const environmentWithoutPrompts = () => ({
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
});
