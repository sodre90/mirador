import { Database } from "bun:sqlite";

/** Run with bun while the test host is stopped: forgets the commands each conversation's agent listed, as a database from before conversations kept them. */
const [databasePath] = process.argv.slice(2);
const db = new Database(databasePath!);
db.run("UPDATE conversations SET agent_commands = NULL, agent_commands_at = NULL");
db.run("DELETE FROM settings WHERE key = 'agent_commands_filled'");
