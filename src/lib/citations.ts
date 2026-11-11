import type { Source } from "./types";

// Providers sometimes use full-width citation brackets despite the prompt.
export function linkCitations(text: string, sources: Source[]) {
  const known = new Set(sources.map((source) => source.id));
  return text.replace(/[\[【](S\d+)[\]】]/g, (_match, id: string) =>
    known.has(id) ? `[${id}](#source-${id})` : "[unverified citation]",
  );
}
