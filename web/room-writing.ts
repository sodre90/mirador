import { WRITING_SIGNAL_EVERY_MS, type RoomWriter } from "../shared/rooms.ts";
import { formatList, t } from "./i18n/index.ts";

const words = t.rooms;

/**
 * Tells the host, for one message box, that you write in it: at your first keystroke, then at most every
 * `WRITING_SIGNAL_EVERY_MS` while you go on, and once more when you empty the box; never what you write. Sending the
 * message ends it on the host by itself.
 */
export class WritingSignals {
  private lastToldAt: number | null = null;

  constructor(
    private readonly tell: (writing: boolean) => void,
    private readonly now: () => number = Date.now,
  ) {}

  typed(text: string) {
    if (text.trim() === "") return this.stopped();
    if (this.lastToldAt !== null && this.now() - this.lastToldAt < WRITING_SIGNAL_EVERY_MS) return;
    this.lastToldAt = this.now();
    this.tell(true);
  }

  sent() {
    this.lastToldAt = null;
  }

  /** The box emptied, or gone with the room or thread it was in. */
  stopped() {
    if (this.lastToldAt === null) return;
    this.lastToldAt = null;
    this.tell(false);
  }
}

/** Who writes where: in the room itself (`threadId` null) or in one thread of it, you left out. */
export const writersIn = (writing: RoomWriter[], threadId: string | null, you: string | null) =>
  writing.filter((writer) => writer.threadId === threadId && writer.personId !== you).map(({ personId }) => personId);

/** "Ann is writing…", "Ann and Béla are writing…", or for more, "Several people are writing…"; null for nobody. */
export function writingLine(names: string[]) {
  if (names.length === 0) return null;
  if (names.length === 1) return words.oneWriting(names[0]!);
  return names.length === 2 ? words.twoWriting(formatList(names)) : words.severalWriting;
}
