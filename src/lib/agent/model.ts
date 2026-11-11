import { ChatGroq } from "@langchain/groq";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { RunnableLambda } from "@langchain/core/runnables";
import { z } from "zod";
import { modelSettings, required } from "../server/config";

export function createModel(maxTokens: number) {
  const config = modelSettings();
  const common = {
    apiKey: required(config.keyName),
    model: config.model,
    temperature: 0,
    maxTokens,
    maxRetries: 0,
    timeout: 30000,
  };
  if (config.provider === "gemini")
    return new ChatGoogleGenerativeAI({
      apiKey: common.apiKey,
      model: common.model,
      temperature: 0,
      maxOutputTokens: maxTokens,
      maxRetries: 0,
      apiVersion: "v1beta",
      ...(config.model.startsWith("gemini-2.5")
        ? { thinkingConfig: { thinkingBudget: 0 } }
        : config.model.startsWith("gemini-3") || config.model.includes("latest")
          ? { thinkingConfig: { thinkingLevel: "LOW" as const } }
          : {}),
    });
  return config.provider === "deepseek"
    ? new ChatDeepSeek({
        ...common,
        modelKwargs: { thinking: { type: "disabled" } },
      })
    : new ChatGroq({ ...common, reasoningEffort: "low" });
}

// Google's native schema uses a single type plus nullable, rather than JSON
// Schema's [type, null]. Keep API conversion here, and validate original Zod
// constraints after generation even where Google's schema cannot express them.
export function geminiSchema(
  input: Record<string, unknown>,
): Record<string, unknown> {
  let node = { ...input };
  const variants = node.anyOf as Record<string, unknown>[] | undefined;
  if (variants?.some((v) => v.type === "null")) {
    const nonNull = variants.filter((v) => v.type !== "null");
    if (nonNull.length === 1) {
      delete node.anyOf;
      node = { ...node, ...nonNull[0], nullable: true };
    }
  }
  if (Array.isArray(node.type)) {
    const types = node.type.filter((t) => t !== "null");
    node = { ...node, type: types[0], nullable: node.type.includes("null") };
  }
  const allowed = new Set([
    "type",
    "description",
    "nullable",
    "enum",
    "items",
    "properties",
    "required",
  ]);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!allowed.has(key)) continue;
    if (key === "type") result[key] = String(value).toUpperCase();
    else if (key === "properties")
      result[key] = Object.fromEntries(
        Object.entries(value as Record<string, Record<string, unknown>>).map(
          ([name, property]) => [name, geminiSchema(property)],
        ),
      );
    else if (key === "items")
      result[key] = geminiSchema(value as Record<string, unknown>);
    else result[key] = value;
  }
  return result;
}

export function structuredOutput<T extends Record<string, unknown>>(
  model: ReturnType<typeof createModel>,
  schema: z.ZodType<T>,
  name: string,
) {
  if (modelSettings().provider === "gemini") {
    return model
      .withStructuredOutput<T>(geminiSchema(z.toJSONSchema(schema)), {
        name,
        method: "functionCalling",
      })
      .pipe(RunnableLambda.from((output: T) => schema.parse(output)));
  }
  return model.withStructuredOutput<T>(schema, { name });
}
