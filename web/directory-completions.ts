import { useEffect, useRef, useState } from "react";
import { connection } from "./connection.ts";

/** The folders of this computer whose path starts with the one typed, as the host lists them, and whether adding it makes a new one. */
export function useDirectoryCompletions(prefix: string) {
  const [completions, setCompletions] = useState({ directories: [] as string[], createsDirectory: false });
  const latestRequest = useRef("");
  useEffect(
    () =>
      connection.onMessage((message) => {
        if (message.type === "fs.completions" && message.requestId === latestRequest.current) {
          setCompletions({ directories: message.directories, createsDirectory: message.createsDirectory });
        }
      }),
    [],
  );
  useEffect(() => {
    const requestId = crypto.randomUUID();
    latestRequest.current = requestId;
    connection.send({ type: "fs.complete", requestId, prefix });
  }, [prefix]);
  return completions;
}
