/** Sandboxes run on Macs and on Linux alone, so what sets up their VMs is tested there: it names this computer's paths in a VM, which Windows' have no place in. */
export const RUNS_SANDBOXES = process.platform !== "win32";
