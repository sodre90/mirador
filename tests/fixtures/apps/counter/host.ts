import type { AppAuthor, AppHost } from "../../../../shared/apps.ts";

/** The smallest app for testing Mirador's app platform: a number that operations add to. */
interface Counter {
  count: number;
  /** The file app_open was given, when it started the counter through documentFor. */
  startedFor?: string;
  /** Who made the latest sign operation, as apply was told. */
  signedBy?: AppAuthor["kind"];
}

const added = (counter: Counter, by: number) => ({
  document: { ...counter, count: counter.count + by },
  inverse: { op: "add", by: -by },
  summary: `Added ${by}; the count is ${counter.count + by}.`,
  touched: ["count"],
});

const host: AppHost<Counter> = {
  parse(text) {
    const value: unknown = JSON.parse(text);
    if (typeof (value as Partial<Counter> | null)?.count !== "number") throw new Error("not a counter: count must be a number");
    return value as Counter;
  },
  serialize: (counter) => `${JSON.stringify(counter, null, 2)}\n`,
  apply(counter, operation, author) {
    const { op, by } = operation as { op?: unknown; by?: unknown };
    if (op === "add" && typeof by === "number") return added(counter, by);
    if (op === "sign") return { document: { ...counter, signedBy: author.kind }, inverse: { op: "sign" }, summary: `Signed by ${author.kind}.` };
    if (op === "crash") return (undefined as unknown as { boom: () => never }).boom();
    throw new Error('Unknown operation; use { op: "add", by: <number> }.');
  },
  describe: (counter) => `The count is ${counter.count}.${counter.startedFor ? ` Started for ${counter.startedFor}.` : ""}`,
  documentFor: (file) => (file.endsWith(".tally") ? file.replace(/\.tally$/, ".json") : null),
  create: (openedFile) => (openedFile ? { count: 0, startedFor: openedFile } : { count: 0 }),
  tasks: {
    "count-up": {
      title: "Count up three times",
      async run({ document, apply, progress }) {
        for (const step of [1, 2, 3]) {
          await apply({ op: "add", by: 1 });
          progress(step / 3, `step ${step} of 3`);
        }
        return `Counted up from ${document.count} to ${document.count + 3}.`;
      },
    },
    sign: {
      title: "Sign as whoever ran it",
      async run({ apply }) {
        return (await apply({ op: "sign" })).summary;
      },
    },
    "write-count": {
      title: "Write the count to counted.txt",
      async run({ document, file }) {
        await Bun.write(file("counted.txt"), `${document.count}\n`);
        return `Wrote ${document.count} to counted.txt.`;
      },
    },
    wait: {
      title: "Wait until stopped",
      run: ({ progress, signal }) =>
        new Promise((_, reject) => {
          progress(null, "waiting");
          signal.addEventListener("abort", () => reject(new Error("stopped while waiting")));
        }),
    },
    fail: {
      title: "Fail on purpose",
      run: async () => {
        throw new Error("the counter can't do that");
      },
    },
  },
};

export default host;
