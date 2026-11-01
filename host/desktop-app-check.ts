/** Tells whether a desktop app listening to the host was built from other code than the checkout has now, so its window may miss fixes. */
export class DesktopAppCheck {
  outdated = false;
  private readonly builtFrom = new Map<object, string>();

  constructor(
    private readonly checkoutCode: () => string | null,
    private readonly changed: (outdated: boolean) => void,
  ) {}

  /** An app built from a release, which carries its own Mirador, tells no code. */
  connected(app: object, code: string | null) {
    if (code === null) return;
    this.builtFrom.set(app, code);
    this.check();
  }

  disconnected(app: object) {
    if (this.builtFrom.delete(app)) this.check();
  }

  private check() {
    const checkout = this.checkoutCode();
    const outdated = checkout !== null && [...this.builtFrom.values()].some((code) => code !== checkout);
    if (outdated === this.outdated) return;
    this.outdated = outdated;
    this.changed(outdated);
  }
}
