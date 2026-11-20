/** Wire + chat types for the OnRecord assistant. Safe to import anywhere. */

export type ApprovalLevel = "read" | "safe_write" | "approval";

export type JsonSchema = Record<string, unknown>;

export type ToolDef = {
  name: string;
  description: string;
  level: ApprovalLevel;
  parameters: JsonSchema;
};

/** What the server needs to know about a tool (no `level`: the phone decides that). */
export type WireToolDef = Pick<ToolDef, "name" | "description" | "parameters">;

export type WireImage = { mime: string; data: string };
export type WireAudio = { mime: string; data: string };

/** One part of a message sent to /api/agent. Base64 only for the live turn. */
export type WirePart =
  | { text: string }
  | { image: WireImage }
  | { audio: WireAudio }
  | { call: { name: string; args: Record<string, unknown>; sig?: string } }
  | { result: { name: string; response: Record<string, unknown> } };

export type WireMessage = { role: "user" | "model"; parts: WirePart[] };

export type SessionContext = {
  date: string;
  business: string;
  counts: { pending: number; products: number; customers: number };
};

export type AgentRequest = {
  session: SessionContext;
  messages: WireMessage[];
  tools: WireToolDef[];
};

/** NDJSON events streamed back by /api/agent. */
export type AgentEvent =
  | { t: "text"; v: string }
  | { t: "call"; name: string; args: Record<string, unknown>; sig?: string }
  | { t: "done" }
  | { t: "error"; code: AgentErrorCode };

export type AgentErrorCode =
  | "unavailable"
  | "busy"
  | "too_large"
  | "throttled"
  | "bad_request"
  | "model_failed";

/** A card shown in chat. Never carries an internal ID in its visible text. */
export type CardState =
  | "awaiting" // approval card waiting for a tap
  | "done"
  | "cancelled"
  | "failed"
  | "undone";

export type CardKind =
  | "order"
  | "customer"
  | "stock"
  | "statement"
  | "action"
  | "products"
  | "orders";

export type CardOpen =
  | { screen: "order"; order_ref: string }
  | { screen: "customer"; customer_ref: string }
  | { screen: "stock" }
  | { screen: "statement" }
  | { screen: "orders" };

export type ChatCard = {
  id: string;
  kind: CardKind;
  title: string;
  lines: string[];
  state?: CardState;
  open?: CardOpen;
  /** For approval cards: what runs when the vendor taps Approve. */
  proposal?: { tool: string; args: Record<string, unknown> };
  /** For safe-write cards: how to undo. */
  undo?: { tool: string; data: Record<string, unknown> };
  note?: string;
};

export type QuickReply = { label: string; send: string };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  cards?: ChatCard[];
  replies?: QuickReply[];
  /** Small JPEG thumbnails only (data URLs). Never the full image. */
  thumbs?: string[];
  /** Voice note marker. The audio itself is never stored. */
  voice?: boolean;
  /** Short progress line while a tool runs ("Checking stock..."). */
  progress?: string;
  error?: { code: AgentErrorCode | "offline"; retry?: boolean };
};
