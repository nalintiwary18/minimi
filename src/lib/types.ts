export type Source = {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  fetchedAt: string;
  publishedAt?: string;
};
export type Turn = {
  id: string;
  session_id: string;
  question: string;
  answer: string | null;
  created_at: string;
  timezone: string;
  sources: Source[];
  status: "pending" | "complete" | "error";
  memory?: MemorySnapshot;
  trace?: ResearchTrace;
};
// An observation is quote-checked evidence, not a guarantee of source truth.
export type ObservedFact = {
  vendor: string;
  plan: string | null;
  kind: "price" | "release" | "claim";
  value: string;
  currency: "USD" | "EUR" | "GBP" | "INR" | null;
  billingPeriod: "month" | "year" | "one-time" | null;
  billingBasis: "seat" | "team" | "usage" | null;
  commitment: "monthly" | "annual" | null;
  sourceId: string;
  quote: string;
  effectiveAt: string | null;
  sourceUrl: string;
  observedAt: string;
};
export type MemorySnapshot = {
  version: 1;
  entities: string[];
  facts: ObservedFact[];
};
export type ResearchTrace = {
  queries: string[];
  followUps: string[];
  rejectedFacts: string[];
  gaps: string[];
  timingsMs: Record<string, number>;
};
export type Session = { id: string; title: string; created_at: string };
export type StreamEvent =
  | { type: "status"; text: string }
  | { type: "token"; text: string }
  | { type: "sources"; sources: Source[] }
  | { type: "done"; turnId: string }
  | { type: "error"; text: string };
