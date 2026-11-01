/** Where a host on hostPort shows its other machines on this computer, one port each; the desktop app's window may load them. */
export const relayPorts = (hostPort: number) => Array.from({ length: 100 }, (_, index) => hostPort + 20 + index);
