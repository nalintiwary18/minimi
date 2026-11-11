type Memory = {
  question: string;
  answer?: string | null;
  truncated?: boolean;
  [key: string]: unknown;
};
type Evidence = {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  fetchedAt: string;
  publishedAt?: string;
};
type Context = {
  question: string;
  memory: Memory[];
  currentSources?: Evidence[];
  [key: string]: unknown;
};

// Limit the actual serialized input, including metadata, for low-TPM accounts.
// Original records and evidence stay intact in storage; only prompt excerpts shrink.
export function packContext(input: Context, budget = 14500) {
  const context = structuredClone(input);
  let serialized = JSON.stringify(context);
  while (serialized.length > budget) {
    let longest = 250;
    let trim: (() => void) | undefined;
    for (const source of context.currentSources || []) {
      if (source.excerpt.length > longest) {
        longest = source.excerpt.length;
        trim = () => {
          source.excerpt = source.excerpt.slice(
            0,
            Math.max(250, Math.floor(longest / 2)),
          );
        };
      }
    }
    for (const memory of context.memory) {
      if ((memory.answer?.length || 0) > longest) {
        longest = memory.answer!.length;
        trim = () => {
          memory.answer = memory.answer!.slice(
            0,
            Math.max(250, Math.floor(longest / 2)),
          );
          memory.truncated = true;
        };
      }
    }
    if (trim) trim();
    else if (context.memory.length > 1) context.memory.pop();
    else if ((context.currentSources?.length || 0) > 1)
      context.currentSources!.pop();
    else {
      // Keep the user's current question intact, even when a past turn is huge.
      const memory = context.memory[0];
      if (memory && memory.question.length > 500) {
        memory.question = memory.question.slice(0, 500);
        memory.truncated = true;
      } else break;
    }
    context.contextTruncated = true;
    serialized = JSON.stringify(context);
  }
  return serialized;
}
