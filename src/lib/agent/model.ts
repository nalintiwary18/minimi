import { ChatGroq } from "@langchain/groq";
import { ChatDeepSeek } from "@langchain/deepseek";
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
  return config.provider === "deepseek"
    ? new ChatDeepSeek({
        ...common,
        modelKwargs: { thinking: { type: "disabled" } },
      })
    : new ChatGroq({ ...common, reasoningEffort: "low" });
}
