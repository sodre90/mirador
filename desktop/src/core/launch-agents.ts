import { join } from "node:path";

const LABEL_PREFIX = "com.sodre90.mirador";

export const hostAgentLabel = (port: number) => `${LABEL_PREFIX}.host.${port}`;
export const openAtLoginLabel = (port: number) => `${LABEL_PREFIX}.open-at-login.${port}`;
export const launchAgentPath = (home: string, label: string) => join(home, "Library", "LaunchAgents", `${label}.plist`);

type PlistValue = string | boolean | string[];

const escapeXml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function plistValue(value: PlistValue): string {
  if (typeof value === "boolean") return value ? "<true/>" : "<false/>";
  if (typeof value === "string") return `<string>${escapeXml(value)}</string>`;
  return `<array>\n${value.map((item) => `    <string>${escapeXml(item)}</string>`).join("\n")}\n  </array>`;
}

function plist(entries: Record<string, PlistValue>) {
  const body = Object.entries(entries)
    .map(([key, value]) => `  <key>${key}</key>\n  ${plistValue(value)}`)
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    body,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

export interface HostAgentSpec {
  label: string;
  argv: string[];
  workingDirectory: string;
  logPath: string;
}

export const hostAgentPlist = ({ label, argv, workingDirectory, logPath }: HostAgentSpec) =>
  plist({
    Label: label,
    ProgramArguments: argv,
    WorkingDirectory: workingDirectory,
    RunAtLoad: true,
    KeepAlive: true,
    StandardOutPath: logPath,
    StandardErrorPath: logPath,
  });

export interface OpenAtLoginSpec {
  label: string;
  appPath: string;
  overrides: Record<string, string>;
}

export const openAtLoginArgv = ({ appPath, overrides }: Pick<OpenAtLoginSpec, "appPath" | "overrides">) => [
  "/usr/bin/open",
  "-a",
  appPath,
  ...Object.entries(overrides).flatMap(([name, value]) => ["--env", `${name}=${value}`]),
];

export const openAtLoginPlist = (spec: OpenAtLoginSpec) =>
  plist({
    Label: spec.label,
    ProgramArguments: openAtLoginArgv(spec),
    RunAtLoad: true,
    LimitLoadToSessionType: "Aqua",
  });

const domain = (uid: number) => `gui/${uid}`;

export const launchctl = {
  bootstrap: (uid: number, plistPath: string) => ["launchctl", "bootstrap", domain(uid), plistPath],
  bootout: (uid: number, label: string) => ["launchctl", "bootout", `${domain(uid)}/${label}`],
  kickstart: (uid: number, label: string) => ["launchctl", "kickstart", "-k", `${domain(uid)}/${label}`],
  print: (uid: number, label: string) => ["launchctl", "print", `${domain(uid)}/${label}`],
};
