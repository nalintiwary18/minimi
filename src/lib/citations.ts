import type { Source } from "./types";
const citationPattern = /[\[【](S\d+(?:\s*,\s*S\d+)*)[\]】]/g;
export function citationIds(text: string) {
  return [...text.matchAll(citationPattern)].flatMap(
    (match) => match[1].match(/S\d+/g) || [],
  );
}

// Providers sometimes use full-width citation brackets despite the prompt.
export function linkCitations(text: string, sources: Source[]) {
  const known = new Set(sources.map((source) => source.id));
  return text.replace(citationPattern, (_match, group: string) =>
    (group.match(/S\d+/g) || [])
      .map((id) =>
        known.has(id) ? `[${id}](#source-${id})` : "[unverified citation]",
      )
      .join(" "),
  );
}
