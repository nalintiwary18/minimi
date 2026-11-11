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
import {
  isPriceComparison,
  canonicalVendor,
  renderComparison,
} from "./comparison";
import {
  Assessment,
  ASSESS_PROMPT,
  validateFacts,
  compareFacts,
  snapshot,
  followUpQueries,
  uncoveredPricing,
  type EvidenceAssessment,
} from "./evidence";
import type { Source, StreamEvent, Turn, ObservedFact } from "../types";

const Plan = z.object({
  memoryQuery: z.string().max(200),
  queries: z.array(z.string().min(3).max(400)).max(10),
  clarification: z.string().nullable(),
  entities: z.array(z.string().max(100)).max(12).nullable().optional(),
});
const State = Annotation.Root({
  memory: Annotation<Turn[]>(),
  plan: Annotation<z.infer<typeof Plan>>(),
  sources: Annotation<Source[]>(),
  failures: Annotation<string[]>(),
  answer: Annotation<string>(),
  assessment: Annotation<EvidenceAssessment>(),
  facts: Annotation<ObservedFact[]>(),
  rejected: Annotation<string[]>(),
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
      // Structured records survive prose truncation; legacy turns remain usable.
      structured: t.memory || null,
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
  dependencies?: {
    retrieve?: typeof retrieve;
    search?: (
      query: string,
      round: "initial" | "follow-up",
    ) => Promise<Omit<Source, "id">[]>;
  },
) {
  const started = performance.now();
  const timingsMs: Record<string, number> = {};
  const attempted: string[] = [],
    followUps: string[] = [];
  const recall = dependencies?.retrieve || retrieve;
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
  const tool = makeWebSearch(signal);
  const search =
    dependencies?.search || ((query: string) => tool.invoke({ query }));
  const research = async (queries: string[], existing: Source[] = []) => {
    attempted.push(...queries);
    const results: PromiseSettledResult<Omit<Source, "id">[]>[] = [];
    for (let i = 0; i < queries.length; i += 4) {
      signal.throwIfAborted();
      results.push(
        ...(await Promise.allSettled(
          queries
            .slice(i, i + 4)
            .map((query) =>
              search(query, existing.length ? "follow-up" : "initial"),
            ),
        )),
      );
    }
    const unique = new Map<string, Source>(existing.map((s) => [s.url, s]));
    const failures: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "rejected")
        failures.push(
          `Search failed: ${queries[i]}. Its claims remain unverified.`,
        );
    });
    for (let rank = 0; rank < 3; rank++)
      for (const r of results) {
        if (r.status === "fulfilled") {
          const s = r.value[rank];
          if (s) {
            const previous = unique.get(s.url);
            if (!previous)
              unique.set(s.url, { ...s, id: `S${unique.size + 1}` });
            else if (existing.length && s.excerpt !== previous.excerpt)
              unique.set(s.url, { ...s, id: previous.id });
          }
        }
      }
    // Persist original excerpts. Only the serialized model context is shortened.
    const sources = [...unique.values()];
    emit({ type: "sources", sources });
    return { sources, failures };
  };
  const assess = async (state: {
    memory: Turn[];
    sources: Source[];
    plan: z.infer<typeof Plan>;
  }) => {
    const evidenceMemory = formatMemory(state.memory).map((m) => ({
      ...m,
      answer: undefined,
      emphasizedText: undefined,
    }));
    const raw = await waitForProvider(
      () =>
        new ChatGroq({
          apiKey: required("GROQ_API_KEY"),
          model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
          temperature: 0,
          // Reserve enough for every vendor, without charging a one-vendor
          // request the same quota estimate as a ten-vendor comparison.
          maxTokens: Math.min(
            3000,
            1100 + Math.max(0, (state.plan.entities?.length || 1) - 1) * 350,
          ),
          reasoningEffort: "low",
          maxRetries: 0,
          timeout: 30000,
        })
          .withStructuredOutput(Assessment, { name: "evidence_assessment" })
          .invoke(
            [
              new SystemMessage(ASSESS_PROMPT),
              new HumanMessage(
                packContext({
                  clock,
                  question: input.question,
                  memory: evidenceMemory,
                  targets: state.plan,
                  currentSources: state.sources,
                }),
              ),
            ],
            { signal },
          ),
      signal,
      waiting,
    );
    const assessment = Assessment.parse(raw);
    const known = [
      ...new Set([
        ...state.memory.flatMap((t) => t.memory?.entities || []),
        ...assessment.facts.map((f) =>
          f.plan && f.vendor.endsWith(` ${f.plan}`)
            ? f.vendor.slice(0, -(f.plan.length + 1))
            : f.vendor,
        ),
      ]),
    ];
    assessment.facts = assessment.facts.map((f) => ({
      ...f,
      vendor: canonicalVendor(f.vendor, known),
    }));
    const checked = validateFacts(assessment, state.sources);
    if (/pric(?:e|es|ing)|expensive|cost/i.test(input.question)) {
      const entities = [
        ...new Set(
          [...(state.plan.entities || []), ...assessment.entities].map((e) =>
            canonicalVendor(e, known),
          ),
        ),
      ];
      for (const entity of entities) {
        if (uncoveredPricing(entity, state.sources, checked.facts)) {
          assessment.gaps.push({
            vendor: entity,
            reason:
              "Some pricing passages remain unverified; conflicting amounts cannot be ruled out.",
            query: `${entity} official pricing currency per seat billing terms`,
          });
        }
        if (
          !checked.facts.some(
            (f) =>
              f.vendor.toLowerCase() === entity.toLowerCase() &&
              f.kind === "price" &&
              f.currency &&
              f.billingPeriod &&
              f.billingBasis &&
              f.commitment,
          )
        ) {
          assessment.gaps.push({
            vendor: entity,
            reason: "Complete price billing terms are missing.",
            query: `${entity} official pricing currency per seat billing terms`,
          });
        }
      }
    }
    assessment.entities = [
      ...new Set(assessment.entities.map((e) => canonicalVendor(e, known))),
    ];
    return { assessment, facts: checked.facts, rejected: checked.rejected };
  };
  emit({ type: "status", text: "Finding relevant conversations" });
  let recalled = await recall(
    input.owner,
    memorySearchQuery(input.question),
    clock.start,
    clock.end,
  );
  // Conversational wording often contains no exact text-search match. In that
  // case, provide recent owner-scoped history rather than pretend none exists.
  if (!recalled.length && !clock.start)
    recalled = await recall(input.owner, "");
  timingsMs.retrieval = performance.now() - started;
  const merge = (a: Turn[], b: Turn[]) =>
    [...new Map([...a, ...b].map((t) => [t.id, t])).values()].slice(-24);
  const graph = new StateGraph(State)
    .addNode("planning", async (state) => {
      emit({ type: "status", text: "Planning the answer" });
      const at = performance.now();
      const dated = state.memory.filter(
        (t) =>
          !clock.start ||
          (t.created_at >= clock.start &&
            (!clock.end || t.created_at < clock.end)),
      );
      const pureDatedRecall =
        clock.start &&
        /what.*(?:ask|question)|which questions/i.test(input.question) &&
        !/correct|today|verify|changed|still/i.test(input.question);
      if (pureDatedRecall) {
        timingsMs.planning = performance.now() - at;
        return {
          plan: {
            memoryQuery: "",
            queries: [],
            clarification: null,
            entities: [],
          },
        };
      }
      if (clock.start && isPriceComparison(input.question)) {
        const candidates = dated.filter(
          (t) => t.status === "complete" && t.memory?.entities.length,
        );
        // One unambiguous structured baseline needs no model to identify its
        // vendors or fabricate dates. Ambiguous and legacy cases use the planner.
        if (candidates.length === 1) {
          const names = candidates[0].memory!.entities;
          const explicit = names.filter((name) =>
            input.question.toLowerCase().includes(name.toLowerCase()),
          );
          const entities = explicit.length ? explicit : names;
          const queries = entities
            .flatMap((vendor) => {
              const plans = [
                ...new Set(
                  candidates[0]
                    .memory!.facts.filter(
                      (f) => f.vendor === vendor && f.kind === "price",
                    )
                    .map((f) => f.plan)
                    .filter(Boolean),
                ),
              ];
              const pricing = `${vendor} ${plans.length === 1 ? plans[0] : ""} official current pricing currency billing terms`;
              return /shipp|release|something big|updates|launch/i.test(
                input.question,
              )
                ? [
                    pricing,
                    `${vendor} official changelog releases since ${clock.mentionedDate}`,
                  ]
                : [pricing];
            })
            .slice(0, 10);
          timingsMs.planning = performance.now() - at;
          return {
            plan: { memoryQuery: "", queries, clarification: null, entities },
          };
        }
        if (
          !dated.length &&
          /asked|spoke|shortlist|remember/i.test(input.question)
        ) {
          timingsMs.planning = performance.now() - at;
          return {
            plan: {
              memoryQuery: "",
              queries: [],
              entities: [],
              clarification: `I couldn't find the saved question for ${clock.mentionedDate}. Which vendors or plans did we discuss?`,
            },
          };
        }
      }
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
        ? await recall(
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
      timingsMs.planning = performance.now() - at;
      return { plan, memory };
    })
    .addNode("research", async (state) => {
      if (state.plan.clarification || !state.plan.queries.length)
        return { sources: [], failures: [] };
      emit({
        type: "status",
        text: `Searching ${state.plan.queries.length} focused queries`,
      });
      const at = performance.now();
      const result = await research(state.plan.queries);
      timingsMs.search = performance.now() - at;
      return result;
    })
    .addNode("checking", async (state) => {
      if (!state.sources.length || state.plan.clarification) return {};
      emit({
        type: "status",
        text: "Checking source support and billing terms",
      });
      const at = performance.now();
      const checked = await assess(state);
      timingsMs.evidence = performance.now() - at;
      return checked;
    })
    .addNode("following_up", async (state) => {
      if (!state.sources.length || state.plan.clarification) return {};
      const queries = followUpQueries(
        state.assessment,
        state.rejected,
        attempted,
      );
      if (!queries.length) return {};
      followUps.push(...queries);
      emit({
        type: "status",
        text: `Resolving ${queries.length} evidence gaps`,
      });
      const at = performance.now();
      const result = await research(queries, state.sources);
      const checked = await assess({ ...state, sources: result.sources });
      timingsMs.followUp = performance.now() - at;
      return {
        ...result,
        failures: [...state.failures, ...result.failures],
        ...checked,
        rejected: [...state.rejected, ...checked.rejected],
      };
    })
    .addNode("responding", async (state) => {
      emit({ type: "status", text: "Writing the answer" });
      const baseline = state.memory.filter(
        (t) =>
          !clock.start ||
          (t.created_at >= clock.start &&
            (!clock.end || t.created_at < clock.end)),
      );
      const entities = [
        ...new Set([
          ...(state.plan.entities || []),
          ...state.assessment.entities,
        ]),
      ];
      if (
        clock.start &&
        /what.*(?:ask|question)|which questions/i.test(input.question) &&
        !/correct|today|verify|changed|still/i.test(input.question)
      ) {
        const answer = baseline.length
          ? `Saved questions for ${clock.mentionedDate}:\n\n${baseline.map((t) => `- “${t.question}”${t.status === "error" ? " — the response did not finish." : ""}`).join("\n")}`
          : `I couldn't find a saved question for ${clock.mentionedDate}.`;
        timingsMs.firstToken = performance.now() - started;
        emit({ type: "token", text: answer });
        return { answer };
      }
      if (
        isPriceComparison(input.question) &&
        !state.plan.clarification &&
        (entities.length || state.facts.length)
      ) {
        const answer = renderComparison(
          baseline,
          state.facts,
          entities,
          /shipp|release|something big|updates|launch/i.test(input.question),
          state.assessment.gaps
            .filter((g) => g.reason.startsWith("Some pricing passages"))
            .map((g) =>
              canonicalVendor(
                g.vendor,
                baseline.flatMap((t) => t.memory?.entities || []),
              ),
            ),
        );
        timingsMs.firstToken = performance.now() - started;
        emit({ type: "token", text: answer });
        return { answer };
      }
      if (state.plan.clarification) {
        const clarification =
          clock.start && !baseline.length && isPriceComparison(input.question)
            ? `I couldn't find the saved question for ${clock.mentionedDate}. Which vendors or plans did we discuss?`
            : state.plan.clarification;
        emit({ type: "token", text: clarification });
        timingsMs.firstToken = performance.now() - started;
        return { answer: clarification };
      }
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
                  checkedFacts: state.facts,
                  comparisons: compareFacts(baseline, state.facts),
                  evidenceGaps: state.assessment.gaps,
                  rejectedFacts: state.rejected,
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
          if (!timingsMs.firstToken && chunk.content)
            timingsMs.firstToken = performance.now() - started;
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
    .addEdge("research", "checking")
    .addEdge("checking", "following_up")
    .addEdge("following_up", "responding")
    .addEdge("responding", END)
    .compile();
  const result = await graph.invoke(
    {
      memory: merge(input.recent.slice(-8), recalled),
      sources: [],
      failures: [],
      answer: "",
      assessment: { entities: [], facts: [], gaps: [] },
      facts: [],
      rejected: [],
    },
    { signal },
  );
  timingsMs.total = performance.now() - started;
  return {
    ...result,
    snapshot: snapshot(
      [...result.assessment.entities, ...(result.plan.entities || [])],
      result.facts,
      result.answer,
    ),
    trace: {
      queries: attempted,
      followUps,
      rejectedFacts: result.rejected,
      gaps: result.assessment.gaps.map((g) => `${g.vendor}: ${g.reason}`),
      timingsMs,
    },
  };
}
