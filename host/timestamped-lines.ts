import { Transform } from "node:stream";
import { formatWithOptions } from "node:util";

const NEWLINE = 0x0a;

/** Starts each line with the time its first output arrived, so an agent's log can be matched up with the host log. */
export const timestampedLines = (now = () => new Date()) => {
  let atLineStart = true;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      const pieces: Buffer[] = [];
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf(NEWLINE, start);
        const end = newline === -1 ? chunk.length : newline + 1;
        if (atLineStart) pieces.push(Buffer.from(`${now().toISOString()} `));
        pieces.push(chunk.subarray(start, end));
        atLineStart = newline !== -1;
        start = end;
      }
      done(null, Buffer.concat(pieces));
    },
  });
};

const stampedLines = (text: string, stamp: string) => text.replace(/^/gm, `${stamp} `);

const writingStampedTo = (stream: NodeJS.WriteStream, now: () => Date) => (...args: unknown[]) =>
  void stream.write(`${stampedLines(formatWithOptions({ colors: false }, ...args), now().toISOString())}\n`);

/**
 * Bun's console writes past process.stdout, so its methods are replaced rather than the streams. A crash's trace,
 * which Bun prints itself, stays unstamped; the exit line right after it says when it happened.
 */
export function stampConsoleLines(now = () => new Date()) {
  console.log = console.info = console.debug = writingStampedTo(process.stdout, now);
  console.warn = console.error = writingStampedTo(process.stderr, now);
  process.on("exit", (code) => console.error(`the host exits with code ${code}`));
}
