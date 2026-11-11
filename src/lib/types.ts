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
};
export type Session = { id: string; title: string; created_at: string };
export type StreamEvent =
  | { type: "status"; text: string }
  | { type: "token"; text: string }
  | { type: "sources"; sources: Source[] }
  | { type: "done"; turnId: string }
  | { type: "error"; text: string };
