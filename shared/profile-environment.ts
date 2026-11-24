export interface ProfileEnvironment {
  set: Record<string, string>;
  /** The variables whose value a shell command prints, by name, from `NAME=$(command)`. */
  commands: Record<string, string>;
  unset: string[];
  errors: string[];
}

const assignment = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|'([^']*)'|([^\s"']*))(?:\s+#.*)?$/;
const assignmentStart = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/;
const commandAssignment = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(?:"\$\((.+?)\)"|\$\((.+?)\))(?:\s+#.*)?$/;
const unsetting = /^-u\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+#.*)?$/;
const secretName = /TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL/i;

const whyTheLineDidNotParse = (line: string, index: number) => {
  const named = line.match(assignmentStart);
  if (!named) return `Line ${index + 1} is not KEY=value, -u KEY or a # comment: ${line}`;
  const name = named[1]!;
  const quote = line.includes("'") && !line.includes('"') ? '"' : "'";
  return `Line ${index + 1}: the value of ${name} has spaces or quotes, so it needs quotes around the whole value, as in ${name}=${quote}the value${quote}`;
};

/** Whether the parentheses in it pair up, so `a)-$(b`, from a line with two commands, isn't taken for one. */
function pairsItsParentheses(text: string) {
  const depths = [...text].reduce<number[]>((seen, character) => [...seen, (seen.at(-1) ?? 0) + (character === "(" ? 1 : character === ")" ? -1 : 0)], []);
  return depths.every((depth) => depth >= 0) && (depths.at(-1) ?? 0) === 0;
}

/**
 * Reads `KEY=value`, `KEY=$(command)`, `-u KEY` and `# comment` lines: the lines of a shell `env` argument
 * array, so a profile can be pasted from an existing `env "${claude_env[@]}" claude` alias.
 */
export function parseEnvironment(text: string): ProfileEnvironment {
  const environment: ProfileEnvironment = { set: {}, commands: {}, unset: [], errors: [] };
  text.split("\n").forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) return;
    const unset = line.match(unsetting);
    if (unset) {
      environment.unset.push(unset[1]!);
      return;
    }
    const fromCommand = line.match(commandAssignment);
    const command = fromCommand?.[2] ?? fromCommand?.[3];
    if (fromCommand && command !== undefined && pairsItsParentheses(command)) {
      delete environment.set[fromCommand[1]!];
      environment.commands[fromCommand[1]!] = command;
      return;
    }
    const assigned = line.match(assignment);
    if (!assigned) {
      environment.errors.push(whyTheLineDidNotParse(line, index));
      return;
    }
    const [, name, doubleQuoted, singleQuoted, bare] = assigned;
    const value = doubleQuoted ?? singleQuoted ?? bare ?? "";
    if (singleQuoted === undefined && value.includes("$")) {
      environment.errors.push(`Line ${index + 1}: ${name} uses $, but values are not expanded; write the value itself, or $(command) alone for what a command prints`);
      return;
    }
    delete environment.commands[name!];
    environment.set[name!] = value;
  });
  return environment;
}

/** A variable a command gives the value of is left out, for whoever ran the command to add. */
export function applyEnvironment(base: Record<string, string>, { set, commands, unset }: ProfileEnvironment): Record<string, string> {
  const result = { ...base };
  [...unset, ...Object.keys(commands)].forEach((name) => delete result[name]);
  return Object.assign(result, set);
}

const holdsLineBreak = (text: string) => /[\r\n]/.test(text);

/** The line that sets the variable to the value; null when no line can, as for a value with quotes of both kinds. */
export function assignmentLine(name: string, value: string): string | null {
  if (holdsLineBreak(value)) return null;
  return [`${name}=${value}`, `${name}="${value}"`, `${name}='${value}'`].find((line) => parseEnvironment(line).set[name] === value) ?? null;
}

/** The line that gives the variable what the command prints; null when no line can. */
export function commandLineOf(name: string, command: string): string | null {
  const line = `${name}=$(${command})`;
  return !holdsLineBreak(command) && parseEnvironment(line).commands[name] === command ? line : null;
}

export const isSecretName = (name: string) => secretName.test(name);

/** The environment text with the values of secret-looking variables replaced, for display. */
export function maskSecrets(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const assigned = line.match(/^(\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=)(.*)$/);
      return assigned && isSecretName(assigned[2]!) && assigned[3] !== "" ? `${assigned[1]}••••••` : line;
    })
    .join("\n");
}
