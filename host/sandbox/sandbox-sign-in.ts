import { signInKeptOpenOnFailure } from "../acp/harnesses.ts";
import { commandShell } from "../command-shell.ts";
import { MASKED_SECRET, type PrintedSecret } from "../terminals.ts";

const TOKEN_LEAD = "sk-ant-oat01-";

/** What `claude setup-token` prints as the long-lived token of the Claude subscription the browser signed in. */
const SETUP_TOKEN = /sk-ant-oat01-[A-Za-z0-9_-]{16,}/g;

const TOKEN_REACHING_THE_END = /sk-ant-oat01-[A-Za-z0-9_-]*$/;

const LEAD_STARTS = Array.from({ length: TOKEN_LEAD.length - 1 }, (_, cut) => TOKEN_LEAD.slice(0, TOKEN_LEAD.length - 1 - cut));

/** Where the output's end may begin a token that the output after it goes on with; its length where it can't. */
function unfinishedTokenAt(output: string) {
  const reachingTheEnd = TOKEN_REACHING_THE_END.exec(output);
  if (reachingTheEnd) return reachingTheEnd.index;
  return output.length - (LEAD_STARTS.find((start) => output.endsWith(start))?.length ?? 0);
}

/** The output of `claude setup-token`, each token it prints going to `caught`, whole even where its output cuts it in two. */
export const setupTokenCaught = (caught: (token: string) => void): PrintedSecret => ({
  masked(output, more) {
    const heldFrom = more ? unfinishedTokenAt(output) : output.length;
    const shown = output.slice(0, heldFrom).replace(SETUP_TOKEN, (token) => {
      caught(token);
      return MASKED_SECRET;
    });
    return { shown, held: output.slice(heldFrom) };
  },
});

/** Its terminal is at least this wide, so the token it prints stays whole on one line, where it is caught and masked. */
export const SANDBOX_SIGN_IN_COLUMNS = 240;

/** While one runs in the conversation's terminals, asking again shows it. */
export const SANDBOX_SIGN_IN_KEY = "sandbox sign-in";

/** `claude setup-token` of the profile's Claude Code, its tab kept open where it fails. */
export const sandboxSignInCommand = (environment: Record<string, string>) =>
  signInKeptOpenOnFailure([environment.CLAUDE_CODE_EXECUTABLE!, "setup-token"], commandShell(() => "/bin/sh", environment));
