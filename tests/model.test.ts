import { afterEach, describe, expect, it, vi } from "vitest";
const models = vi.hoisted(() => ({
  groq: vi.fn(),
  deepseek: vi.fn(),
  gemini: vi.fn(),
}));
vi.mock("@langchain/google-genai", () => ({
  ChatGoogleGenerativeAI: class {
    constructor(options: unknown) {
      models.gemini(options);
    }
  },
}));
vi.mock("@langchain/groq", () => ({
  ChatGroq: class {
    constructor(options: unknown) {
      models.groq(options);
    }
  },
}));
vi.mock("@langchain/deepseek", () => ({
  ChatDeepSeek: class {
    constructor(options: unknown) {
      models.deepseek(options);
    }
  },
}));
import { createModel } from "../src/lib/agent/model";
import { modelSettings } from "../src/lib/server/config";
import { geminiSchema, structuredOutput } from "../src/lib/agent/model";
import { RunnableLambda } from "@langchain/core/runnables";
import { z } from "zod";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("model provider selection", () => {
  it("converts nullable nested fields into Google's single-type schema", () => {
    const schema = z.object({
      facts: z.array(
        z.object({
          currency: z.enum(["USD", "EUR"]).nullable(),
          plan: z.string().nullable(),
        }),
      ),
      entities: z.array(z.string()).nullable().optional(),
    });
    const converted = geminiSchema(z.toJSONSchema(schema)) as {
      properties: {
        facts: { items: { properties: Record<string, unknown> } };
        entities: Record<string, unknown>;
      };
    };
    expect(converted.properties.facts.items.properties.currency).toMatchObject({
      type: "STRING",
      nullable: true,
      enum: ["USD", "EUR"],
    });
    expect(converted.properties.facts.items.properties.plan).toMatchObject({
      type: "STRING",
      nullable: true,
    });
    expect(converted.properties.entities).toMatchObject({
      type: "ARRAY",
      nullable: true,
    });
  });
  it("still validates constraints omitted by Google's schema", async () => {
    vi.stubEnv("LLM_PROVIDER", "gemini");
    const fake = {
      withStructuredOutput: () => RunnableLambda.from(() => ({ quote: "x" })),
    } as unknown as ReturnType<typeof createModel>;
    const output = structuredOutput(
      fake,
      z.object({ quote: z.string().min(8) }),
      "quote_check",
    );
    await expect(output.invoke("extract quote")).rejects.toThrow();
  });
  it("uses Gemini's token field and key without the other providers", () => {
    vi.stubEnv("LLM_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "test-gemini");
    vi.stubEnv("GEMINI_MODEL", "gemini-flash-latest");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    createModel(1400);
    expect(models.gemini).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-gemini",
        model: "gemini-flash-latest",
        maxOutputTokens: 1400,
      }),
    );
    expect(models.groq).not.toHaveBeenCalled();
    expect(models.deepseek).not.toHaveBeenCalled();
    expect(modelSettings().endpoint).toContain(
      "gemini-flash-latest:generateContent",
    );
  });
  it("uses the DeepSeek key and model without requiring Groq credentials", () => {
    vi.stubEnv("LLM_PROVIDER", "deepseek");
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek");
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-flash");
    vi.stubEnv("GROQ_API_KEY", "");
    createModel(1100);
    expect(models.deepseek).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-deepseek",
        model: "deepseek-flash",
        maxTokens: 1100,
      }),
    );
    expect(models.groq).not.toHaveBeenCalled();
    expect(modelSettings().label).toBe("DeepSeek");
  });
  it("retains Groq as a selectable provider", () => {
    vi.stubEnv("LLM_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", "test-groq");
    createModel(700);
    expect(models.groq).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "test-groq", reasoningEffort: "low" }),
    );
    expect(models.deepseek).not.toHaveBeenCalled();
  });
  it("rejects missing selected credentials and invalid provider names", () => {
    vi.stubEnv("LLM_PROVIDER", "deepseek");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    expect(() => createModel(700)).toThrow("Missing DEEPSEEK_API_KEY");
    vi.stubEnv("LLM_PROVIDER", "invalid");
    expect(modelSettings).toThrow("LLM_PROVIDER");
  });
});
