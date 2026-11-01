export interface ProfileEnvironment {
  set: Record<string, string>;
  unset: string[];
  errors: string[];
}

const assignment = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|'([^']*)'|([^\s"'#]*))\s*(?:#.*)?$/;
const unsetting = /^-u\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:#.*)?$/;
const secretName = /TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL/i;

/**
 * Reads `KEY=value`, `-u KEY` and `# comment` lines: the lines of a shell `env` argument
 * array, so a profile can be pasted from an existing `env "${claude_env[@]}" claude` alias.
 */
export function parseEnvironment(text: string): ProfileEnvironment {
  const environment: ProfileEnvironment = { set: {}, unset: [], errors: [] };
  text.split("\n").forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) return;
    const unset = line.match(unsetting);
    if (unset) {
      environment.unset.push(unset[1]!);
      return;
    }
    const assigned = line.match(assignment);
    if (!assigned) {
      environment.errors.push(`Line ${index + 1} is not KEY=value, -u KEY or a # comment: ${line}`);
      return;
    }
    const [, name, doubleQuoted, singleQuoted, bare] = assigned;
    const value = doubleQuoted ?? singleQuoted ?? bare ?? "";
    if (singleQuoted === undefined && value.includes("$")) {
      environment.errors.push(`Line ${index + 1}: ${name} uses $, but values are not expanded; write the value itself`);
      return;
    }
    environment.set[name!] = value;
  });
  return environment;
}

export function applyEnvironment(base: Record<string, string>, { set, unset }: ProfileEnvironment): Record<string, string> {
  const result = { ...base };
  unset.forEach((name) => delete result[name]);
  return Object.assign(result, set);
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
