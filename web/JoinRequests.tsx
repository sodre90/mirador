import { useEffect, useState, type FormEvent } from "react";
import { typedNumber } from "../shared/join-requests.ts";
import type { JoinRequest } from "../shared/model.ts";
import { connection } from "./connection.ts";
import { t } from "./i18n/index.ts";

const words = t.devices.joinRequest;

const NUMBER_LENGTH = 6;

function useExpired(expiresAt: number) {
  const [expired, setExpired] = useState(() => expiresAt <= Date.now());
  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), expiresAt - Date.now());
    return () => clearTimeout(timer);
  }, [expiresAt]);
  return expired;
}

function JoinRequestPrompt({ request }: { request: JoinRequest }) {
  const [number, setNumber] = useState("");
  const [answering, setAnswering] = useState(false);
  if (useExpired(request.expiresAt)) return null;

  const approve = (event: FormEvent) => {
    event.preventDefault();
    setAnswering(connection.send({ type: "join-request.approve", requestId: crypto.randomUUID(), joinRequestId: request.id, number }));
  };

  return (
    <section className="join-request" role="alertdialog" aria-label={words.label(request.name)}>
      <h2>{words.title(request.name)}</h2>
      <p>
        {words.from(request.fromAddress)}
        {request.tailscaleUser && (
          <>
            {words.signedInAs} <strong>{request.tailscaleUser}</strong>
          </>
        )}
        {words.approveOnly}
      </p>
      <form onSubmit={approve}>
        <input
          aria-label={words.number}
          value={number}
          onChange={(event) => setNumber(event.target.value)}
          placeholder="123 456"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="primary" disabled={answering || typedNumber(number).length !== NUMBER_LENGTH}>
          {words.approve}
        </button>
        <button type="button" disabled={answering} onClick={() => setAnswering(connection.send({ type: "join-request.deny", joinRequestId: request.id }))}>
          {words.deny}
        </button>
      </form>
    </section>
  );
}

/** On every page of this host, so whoever asked to join can be let in from whichever screen is at hand. */
export function JoinRequestPrompts({ joinRequests }: { joinRequests: JoinRequest[] }) {
  if (joinRequests.length === 0) return null;
  return (
    <div className="join-requests">
      {joinRequests.map((request) => (
        <JoinRequestPrompt key={request.id} request={request} />
      ))}
    </div>
  );
}
