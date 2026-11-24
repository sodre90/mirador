/** The icon a workspace's folder holds, as data URLs: `light`, and what takes its place in a dark theme. */
export interface WorkspaceIcon {
  light: string | null;
  dark: string | null;
}

export const iconInTheme = (icon: WorkspaceIcon | null | undefined, theme: "light" | "dark") => (theme === "dark" ? (icon?.dark ?? icon?.light) : icon?.light) ?? null;
