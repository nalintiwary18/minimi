import { afterEach, describe, expect, it, vi } from "vitest";
const models = vi.hoisted(() => ({ groq: vi.fn(), deepseek: vi.fn() }));
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
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("model provider selection", () => {
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
