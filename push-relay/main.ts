#!/usr/bin/env bun
/**
 * mirador-push-relay: holds the APNs and FCM keys, so Mirador hosts don't, and passes on pushes it can't read.
 *
 *   bun push-relay/main.ts serve
 *   bun push-relay/main.ts token add <label>      prints a Mac's token once
 *   bun push-relay/main.ts token remove <label>
 *   bun push-relay/main.ts token list
 *
 * Configured by environment, with the secrets in files:
 *   PUSH_RELAY_PORT (default 8790), PUSH_RELAY_HOSTNAME (default 127.0.0.1), PUSH_RELAY_TOKENS_FILE (required)
 *   APNS_KEY_FILE, APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC: Apple, all or none
 *   FCM_SERVICE_ACCOUNT_FILE: Google's service-account JSON key
 */
import { readFileSync } from "node:fs";
import { Apns } from "./apns.ts";
import { Fcm, type ServiceAccount } from "./fcm.ts";
import { addHostToken, hostTokenLabels, removeHostToken } from "./host-tokens.ts";
import { LONGEST_BODY, relayHandler } from "./server.ts";

const DEFAULT_PORT = 8790;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

function apnsFromEnvironment() {
  const names = ["APNS_KEY_FILE", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_TOPIC"];
  const set = names.filter((name) => process.env[name]);
  if (set.length === 0) return null;
  if (set.length < names.length) throw new Error(`Apple needs all of ${names.join(", ")}.`);
  return new Apns({ key: readFileSync(required("APNS_KEY_FILE"), "utf8"), keyId: required("APNS_KEY_ID"), teamId: required("APNS_TEAM_ID"), topic: required("APNS_TOPIC") });
}

function fcmFromEnvironment() {
  const file = process.env.FCM_SERVICE_ACCOUNT_FILE;
  return file ? new Fcm({ account: JSON.parse(readFileSync(file, "utf8")) as ServiceAccount }) : null;
}

function serve() {
  const tokensFile = required("PUSH_RELAY_TOKENS_FILE");
  const senders = { apns: apnsFromEnvironment(), fcm: fcmFromEnvironment() };
  const server = Bun.serve({
    hostname: process.env.PUSH_RELAY_HOSTNAME ?? "127.0.0.1",
    port: Number(process.env.PUSH_RELAY_PORT ?? DEFAULT_PORT),
    maxRequestBodySize: LONGEST_BODY,
    fetch: relayHandler({ tokensFile, senders }),
  });
  console.log(`mirador-push-relay on ${server.hostname}:${server.port}; Apple ${senders.apns ? "on" : "off"}, Google ${senders.fcm ? "on" : "off"}`);
}

function tokens([command, label]: string[]) {
  const file = required("PUSH_RELAY_TOKENS_FILE");
  if (command === "add" && label) return console.log(addHostToken(file, label));
  if (command === "remove" && label) return removeHostToken(file, label);
  if (command === "list") return hostTokenLabels(file).forEach((each) => console.log(each));
  throw new Error("Usage: token add <label> | token remove <label> | token list");
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "serve") serve();
  else if (command === "token") tokens(rest);
  else throw new Error("Usage: serve | token add <label> | token remove <label> | token list");
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
