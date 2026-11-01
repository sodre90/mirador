/**
 * What the desktop app tells a host it starts on Windows, where a process cannot re-execute itself, so the host can
 * restart through what started it.
 */
export const HOST_RELAUNCH = {
  /** The name of the scheduled task that runs a background host, which the host runs again to restart. */
  scheduledTask: "MIRADOR_SCHEDULED_TASK",
  /** Set on a host the app starts again when it exits with this code. */
  restartExitCode: "MIRADOR_RESTART_EXIT_CODE",
  /** A file the host writes its pid into as it starts, as the app does not start a background host itself. */
  pidFile: "MIRADOR_PID_FILE",
} as const;

export const HOST_RESTART_EXIT_CODE = 75;
