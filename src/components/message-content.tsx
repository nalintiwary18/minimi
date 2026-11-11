import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Source } from "@/lib/types";
import { linkCitations } from "@/lib/citations";

export function dateLabel(instant: string) {
  return new Date(instant).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
export function Answer({ text, sources }: { text: string; sources: Source[] }) {
  const cited = linkCitations(text, sources);
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const source = sources.find((s) => `#source-${s.id}` === href);
            const target = source?.url || href || "";
            return /^https?:\/\//i.test(target) ? (
              <a href={target} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            );
          },
        }}
      >
        {cited}
      </ReactMarkdown>
    </div>
  );
}
export function SourceList({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;
  return (
    <details className="sources">
      <summary>
        {sources.length} sources <span>View evidence</span>
      </summary>
      <div className="source-grid">
        {sources.map((s) => (
          <a
            key={s.id}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            title={s.excerpt}
          >
            <span>
              {s.id} · {new URL(s.url).hostname.replace(/^www\./, "")}
            </span>
            <strong>{s.title}</strong>
            <small>
              Retrieved {dateLabel(s.fetchedAt)}
              {s.publishedAt ? ` · Published ${s.publishedAt}` : ""}
            </small>
          </a>
        ))}
      </div>
    </details>
  );
}
