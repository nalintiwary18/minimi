import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { ChatGroq } from "@langchain/groq";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { DateTime } from "luxon";
import { required } from "../server/config";
import { retrieve } from "../server/db";
import { timeContext } from "./time";
import { makeWebSearch } from "./search";
import { PLAN_PROMPT, ANSWER_PROMPT } from "./prompts";
import { waitForProvider } from "./provider-errors";
import { packContext } from "./context";
import { memorySearchQuery } from "./memory-query";
import type { Source, StreamEvent, Turn } from "../types";

const Plan = z.object({
  memoryQuery: z.string().max(200),
  queries: z.array(z.string().min(3).max(400)).max(10),
  clarification: z.string().nullable(),
});
const State = Annotation.Root({
  memory: Annotation<Turn[]>(),
  plan: Annotation<z.infer<typeof Plan>>(),
  sources: Annotation<Source[]>(),
  failures: Annotation<string[]>(),
  answer: Annotation<string>(),
});
export function formatMemory(turns: Turn[]) {
  // Distribute a context budget over all recalled turns; clearly mark truncation.
  const budget = Math.floor(8000 / Math.max(turns.length, 1));
  return turns.map((t) => {
    const question = t.question.slice(0, Math.min(3000, budget / 2));
    const answer = t.answer?.slice(0, Math.max(0, budget - question.length));
    return {
      at: t.created_at,
      localDate: DateTime.fromISO(t.created_at).setZone(t.timezone).toISODate(),
      timezone: t.timezone,
      status: t.status,
      question,
      answer,
      // Preserve emphasized names beyond the excerpt (e.g. a five-vendor table).
      emphasizedText: [...(t.answer || "").matchAll(/\*\*([^*\n]{1,120})\*\*/g)]
        .slice(0, 24)
        .map((match) => match[1]),
      truncated: question !== t.question || answer !== t.answer,
    };
  });
}
export async function runAgent(
  input: {
    owner: string;
    question: string;
    timezone: string;
    recent: Turn[];
    now: Date;
  },
  emit: (event: StreamEvent) => void,
  signal: AbortSignal,
) {
  const clock = timeContext(input.question, input.timezone, input.now);
  const llm = new ChatGroq({
    apiKey: required("GROQ_API_KEY"),
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    temperature: 0,
    maxTokens: 1400,
    reasoningEffort: "low",
    maxRetries: 0,
    timeout: 30000,
  });
  const plannerModel = new ChatGroq({
    apiKey: required("GROQ_API_KEY"),
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    temperature: 0,
    maxTokens: 700,
    reasoningEffort: "low",
    maxRetries: 0,
    timeout: 30000,
  });
  const waiting = (seconds: number) =>
    emit({
      type: "status",
      text: `Groq is busy. Retrying in ${seconds} seconds`,
    });
  const search = makeWebSearch(signal);
  emit({ type: "status", text: "Finding relevant conversations" });
  let recalled = await retrieve(
    input.owner,
    memorySearchQuery(input.question),
    clock.start,
    clock.end,
  );
  // Conversational wording often contains no exact text-search match. In that
  // case, provide recent owner-scoped history rather than pretend none exists.
  if (!recalled.length && !clock.start)
    recalled = await retrieve(input.owner, "");
  const merge = (a: Turn[], b: Turn[]) =>
    [...new Map([...a, ...b].map((t) => [t.id, t])).values()].slice(-24);
  const graph = new StateGraph(State)
    .addNode("planning", async (state) => {
      emit({ type: "status", text: "Planning the answer" });
      const planner = plannerModel.withStructuredOutput(Plan, {
        name: "answer_plan",
      });
      const context = (memory: Turn[]) => [
        new SystemMessage(PLAN_PROMPT),
        new HumanMessage(
          packContext({
            clock,
            question: input.question,
            memory: formatMemory(memory),
          }),
        ),
      ];
      let plan = await waitForProvider(
        () => planner.invoke(context(state.memory), { signal }),
        signal,
        waiting,
      );
      const extra = plan.memoryQuery
        ? await retrieve(
            input.owner,
            memorySearchQuery(plan.memoryQuery),
            clock.start,
            clock.end,
          )
        : [];
      const memory = merge(state.memory, extra);
      // Newly recovered vendors/baselines must inform search queries, not just prose.
      if (extra.some((t) => !state.memory.some((m) => m.id === t.id)))
        plan = await waitForProvider(
          () => planner.invoke(context(memory), { signal }),
          signal,
          waiting,
        );
      return { plan, memory };
    })
    .addNode("research", async (state) => {
      if (state.plan.clarification || !state.plan.queries.length)
        return { sources: [], failures: [] };
      emit({
        type: "status",
        text: `Searching ${state.plan.queries.length} focused queries`,
      });
      const results: PromiseSettledResult<unknown>[] = [];
      // Bounded concurrency keeps a ten-vendor comparison within provider limits.
      for (let i = 0; i < state.plan.queries.length; i += 4) {
        signal.throwIfAborted();
        results.push(
          ...(await Promise.allSettled(
            state.plan.queries
              .slice(i, i + 4)
              .map((query) => search.invoke({ query })),
          )),
        );
      }
      const unique = new Map<string, Omit<Source, "id">>();
      const failures: string[] = [];
      results.forEach((r, i) => {
        if (r.status === "rejected")
          failures.push(
            `Search failed: ${state.plan.queries[i]}. Its claims remain unverified.`,
          );
      });
      // Round-robin avoids letting the first vendor consume all evidence space.
      for (let rank = 0; rank < 3; rank++)
        for (const result of results) {
          if (result.status === "fulfilled") {
            const source = (result.value as Omit<Source, "id">[])[rank];
            if (source && !unique.has(source.url))
              unique.set(source.url, source);
          }
        }
      const excerptBudget = Math.floor(26000 / Math.max(unique.size, 1));
      const sources = [...unique.values()].map((s, i) => ({
        ...s,
        excerpt: s.excerpt.slice(0, excerptBudget),
        id: `S${i + 1}`,
      }));
      emit({ type: "sources", sources });
      return { sources, failures };
    })
    .addNode("responding", async (state) => {
      emit({ type: "status", text: "Writing the answer" });
      let answer = "";
      const stream = await waitForProvider(
        () =>
          llm.stream(
            [
              new SystemMessage(ANSWER_PROMPT),
              new HumanMessage(
                packContext({
                  clock,
                  question: input.question,
                  memory: formatMemory(state.memory),
                  clarification: state.plan.clarification,
                  failures: state.failures,
                  currentSources: state.sources,
                }),
              ),
            ],
            { signal },
          ),
        signal,
        waiting,
      );
      for await (const chunk of stream) {
        if (typeof chunk.content === "string") {
          answer += chunk.content;
          emit({ type: "token", text: chunk.content });
        }
      }
      if (!answer.trim())
        throw new Error(
          "The model returned an empty answer. Please try again.",
        );
      return { answer };
    })
    .addEdge(START, "planning")
    .addEdge("planning", "research")
    .addEdge("research", "responding")
    .addEdge("responding", END)
    .compile();
  return graph.invoke(
    {
      memory: merge(input.recent.slice(-8), recalled),
      sources: [],
      failures: [],
      answer: "",
    },
    { signal },
  );
}
