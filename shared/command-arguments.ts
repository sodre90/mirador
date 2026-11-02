import { HostProblemError } from "./host-problems.ts";

type Schema = Record<string, unknown>;

const propertiesOf = (schema: Schema): Record<string, Schema> => (typeof schema.properties === "object" && schema.properties !== null ? (schema.properties as Record<string, Schema>) : {});

const requiredOf = (schema: Schema): string[] => (Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === "string") : []);

/** What a command takes after its name, for the slash menu: `title=… [mood=…]`, the required first; null when it takes nothing. */
export function argumentsHint(schema: Schema): string | null {
  const required = requiredOf(schema);
  const optional = Object.keys(propertiesOf(schema)).filter((name) => !required.includes(name));
  const parts = [...required.map((name) => `${name}=…`), ...optional.map((name) => `[${name}=…]`)];
  return parts.length > 0 ? parts.join(" ") : null;
}

/** A word after the name: `key=value`, its value in double or single quotes when it holds spaces, or anything else, which is refused. */
const WORD = /[^\s=]+=(?:"(?:[^"\\]|\\.)*"|'[^']*'|\S*)|\S+/g;

/** A backslash in double quotes keeps the next character. */
const KEY_VALUE = /^([^\s=]+)=(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S*))$/;

function keyValues(text: string): [string, string][] {
  return (text.match(WORD) ?? []).map((word) => {
    const match = KEY_VALUE.exec(word);
    if (!match) throw new HostProblemError({ code: "command-arguments-syntax", near: word });
    const [, key, doubleQuoted, singleQuoted, bare] = match;
    return [key!, doubleQuoted !== undefined ? doubleQuoted.replace(/\\(.)/g, "$1") : (singleQuoted ?? bare ?? "")];
  });
}

const takesText = (property: Schema | undefined) => property?.type === "string" || property?.type === undefined;

/** A value as the property's type takes it: as written for text, else read as JSON (numbers, true and false, lists, objects), else as written for the schema to refuse. */
function valueFor(property: Schema | undefined, written: string): unknown {
  if (takesText(property)) return written;
  try {
    return JSON.parse(written);
  } catch {
    return written;
  }
}

/** The tool's input from what follows a command's name; throws, naming what would work, for words it can't take. */
export function commandInput(text: string, schema: Schema): Record<string, unknown> {
  const properties = propertiesOf(schema);
  const input = Object.fromEntries(
    keyValues(text).map(([key, written]) => {
      if (!Object.hasOwn(properties, key)) throw new HostProblemError({ code: "command-argument-unknown", argument: key, known: Object.keys(properties) });
      return [key, valueFor(properties[key], written)];
    }),
  );
  const missing = requiredOf(schema).filter((name) => !Object.hasOwn(input, name));
  if (missing.length > 0) throw new HostProblemError({ code: "command-arguments-missing", missing });
  return input;
}
