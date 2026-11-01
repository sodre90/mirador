/** The checkout diagram the agent draws in the show clip, which the trailer's opening also draws out of the wall of text. */
export const CHECKOUT_TITLE = "Checkout, end to end";
export const CHECKOUT_LEAD = "One request, four services, in the order they run. ⚠ marks where an order can get stuck.";

export const CHECKOUT_FLOW = `sequenceDiagram
  autonumber
  participant B as Browser
  participant A as Checkout API
  participant I as Inventory
  participant P as Payments
  participant O as Orders
  B->>A: POST /checkout
  A->>I: reserve(cart.items)
  I-->>A: reservation
  A->>P: capture(card, total)
  Note over A,P: ⚠ no idempotency key
  P-->>A: payment
  A->>O: create(cart, payment)
  O-->>A: order 1042
  A->>A: ⚠ send the email in the request
  A-->>B: 201 Created
`;

export const CHECKOUT_RISKS = [
  { title: "Declined card", detail: "Stock stays reserved until the nightly job.", slow: false },
  { title: "Retried capture", detail: "Without a key, the card is charged twice.", slow: false },
  { title: "Slow mail server", detail: "Holds the order open while it sends.", slow: true },
];

export const MERMAID_SEQUENCE = { mirrorActors: false, showSequenceNumbers: true };

/** The flow the agent draws again once the user points at the slow mail server and asks for the email to leave the request. */
export const CHECKOUT_FLOW_QUEUED = `sequenceDiagram
  autonumber
  participant B as Browser
  participant A as Checkout API
  participant I as Inventory
  participant P as Payments
  participant O as Orders
  participant Q as Mail queue
  B->>A: POST /checkout
  A->>I: reserve(cart.items)
  I-->>A: reservation
  A->>P: capture(card, total)
  Note over A,P: ⚠ no idempotency key
  P-->>A: payment
  A->>O: create(cart, payment)
  O-->>A: order 1042
  A-->>B: 201 Created
  A-)Q: send the email, after the response
`;

export const CHECKOUT_RISKS_QUEUED = [
  { title: "Declined card", detail: "Stock stays reserved until the nightly job.", slow: false },
  { title: "Retried capture", detail: "Without a key, the card is charged twice.", slow: false },
  { title: "Mail server", detail: "✓ Off the request: a queue sends the email.", slow: false, fixed: true },
];
