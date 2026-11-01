import { isNewerVersion, type NewerVersion } from "../../../shared/newer-version.ts";

const CHECK_EVERY_MILLISECONDS = 6 * 60 * 60 * 1000;
const REFUSED = "Mirador could not install it";

/** A build published on the latest release, other than the one running. */
export interface PublishedBuild {
  version: string;
  hash: string;
}

/** A newer Mirador the app is downloading, can restart into, or found but cannot install, and why. */
export type UpdateOffer = PublishedBuild & ({ stage: "downloading" } | { stage: "ready" } | { stage: "blocked"; blockedBy: string });

export interface SelfUpdatePorts {
  currentVersion: string;
  /** The latest release's build when it differs from this one; null when it doesn't, or nobody could tell. */
  published(): Promise<PublishedBuild | null>;
  /** Why the app cannot replace itself where it is, such as a folder it may not write; null when it can. */
  blockedBy(): string | null;
  /** Downloads it next to the running build's archive, from which a patch makes it when the release has one. */
  download(build: PublishedBuild): Promise<void>;
  /** Whether the downloaded app is signed as this one is; the app's maker vouches for nothing more than that. */
  trusted(build: PublishedBuild): Promise<boolean>;
  /** Deletes the download, but not the running build's archive: later patches apply to that. */
  discard(hash: string): void;
  /** Builds never to offer again, as they were refused or failed to install. */
  skipped: { has(hash: string): boolean; add(hash: string): void };
  install(): Promise<void>;
}

/** Looks for a newer release at start and every few hours, downloads it quietly and offers it once it is trusted. */
export class SelfUpdate {
  offer: UpdateOffer | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private looking: Promise<void> = Promise.resolve();

  constructor(
    private readonly ports: SelfUpdatePorts,
    private readonly changed: (offer: UpdateOffer | null) => void,
  ) {}

  start() {
    void this.look();
    this.timer = setInterval(() => void this.look(), CHECK_EVERY_MILLISECONDS);
  }

  stop() {
    clearInterval(this.timer);
  }

  /** One look at a time, so a slow download can't end after a later look and bring back what it dropped. */
  look() {
    this.looking = this.looking.then(() => this.lookOnce()).catch(() => {});
    return this.looking;
  }

  /** The host looks when it starts, so after a restart of the host alone it can find a release before this app does. */
  lookFor(newerVersion: NewerVersion | null) {
    if (newerVersion?.kind !== "release" || this.offer?.version === newerVersion.version) return this.looking;
    return this.look();
  }

  /** Electrobun tells, at the next start, that the swap into this build failed; the app then runs the build it had. */
  failedToInstall(hash: string) {
    this.ports.discard(hash);
    this.ports.skipped.add(hash);
    if (this.offer?.hash === hash) this.show(refused(this.offer));
  }

  async install() {
    if (this.offer?.stage === "ready") await this.ports.install();
  }

  private async lookOnce() {
    const { ports } = this;
    // A check that could not reach the latest release tells nothing new, so what it offered stays, a downloaded update too.
    const build = await ports.published().catch(() => undefined);
    if (build === undefined) return;
    if (!build || !isNewerVersion(build.version, ports.currentVersion)) return this.show(null);
    if (ports.skipped.has(build.hash)) return this.show(refused(build));
    if (this.offer?.hash === build.hash && this.offer.stage === "ready") return;
    const blockedBy = ports.blockedBy();
    if (blockedBy) return this.show({ ...build, stage: "blocked", blockedBy });
    this.show({ ...build, stage: "downloading" });
    if (!(await this.downloaded(build))) return this.show(null);
    if (!(await ports.trusted(build).catch(() => false))) {
      ports.discard(build.hash);
      ports.skipped.add(build.hash);
      return this.show(refused(build));
    }
    this.show({ ...build, stage: "ready" });
  }

  private downloaded(build: PublishedBuild) {
    return this.ports.download(build).then(
      () => true,
      () => false,
    );
  }

  private show(offer: UpdateOffer | null) {
    if (JSON.stringify(offer) === JSON.stringify(this.offer)) return;
    this.offer = offer;
    this.changed(offer);
  }
}

const refused = ({ version, hash }: PublishedBuild): UpdateOffer => ({ version, hash, stage: "blocked", blockedBy: REFUSED });
