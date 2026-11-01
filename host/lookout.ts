import { problemFieldsOf, type DescribedProblem } from "../shared/host-problems.ts";
const CHECK_EVERY_MILLISECONDS = 6 * 60 * 60 * 1000;

/** Looks when started and every few hours, and says when the answer changes; when it can't tell, offline for one, the last answer stands. */
export class Lookout<T> {
  current: T | null = null;
  private started = false;
  private timer?: ReturnType<typeof setInterval>;
  private looking: Promise<void> = Promise.resolve();

  constructor(
    private readonly lookup: (fetching: boolean, last: T | null) => Promise<T | null>,
    private readonly changed: (found: T | null) => void,
  ) {}

  start() {
    this.started = true;
    this.look(true);
    this.lookEveryFewHours();
  }

  private lookEveryFewHours() {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.look(true), CHECK_EVERY_MILLISECONDS);
  }

  stop() {
    clearInterval(this.timer);
  }

  /** After a change that settles the answer here; fetching says whether the lookup should ask the remote again. A lookout not started, as test hosts' aren't, doesn't recount either. */
  recount(fetching = false) {
    if (this.started) this.look(fetching);
  }

  /** One look at a time, so a slow fetch can't finish after a later recount and bring back what that recount cleared. */
  look(fetching: boolean) {
    const failure = this.looking.then(() => this.lookOnce(fetching));
    this.looking = failure.then(() => {});
    return failure;
  }

  /** A look the user asked for puts off the next look by itself; a lookout not started looks all the same, as the user asked. */
  lookNow() {
    if (this.started) this.lookEveryFewHours();
    return this.look(true);
  }

  /** Why the look failed, or null when it didn't. */
  private async lookOnce(fetching: boolean): Promise<DescribedProblem | null> {
    try {
      this.take(await this.lookup(fetching, this.current));
      return null;
    } catch (error) {
      return problemFieldsOf(error, error instanceof Error ? error.message : String(error));
    }
  }

  private take(found: T | null) {
    if (JSON.stringify(found) === JSON.stringify(this.current)) return;
    this.current = found;
    this.changed(found);
  }
}
