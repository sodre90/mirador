import { Database } from "bun:sqlite";

/** Run with bun: prints the conversations of the agents of the room with the name, one a line. */
const [databasePath, roomName] = process.argv.slice(2);
const db = new Database(databasePath!, { readonly: true });
const conversations = db
  .query("SELECT conversation_id AS id FROM room_agents JOIN rooms ON rooms.id = room_agents.room_id WHERE rooms.name = ? AND conversation_id IS NOT NULL")
  .all(roomName!) as { id: string }[];
console.log(conversations.map(({ id }) => id).join("\n"));
