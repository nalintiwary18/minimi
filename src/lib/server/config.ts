export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Add it to .env.local.`);
  return value;
}

export function modelSettings() {
  const provider = process.env.LLM_PROVIDER || "groq";
  if (provider === "gemini")
    return {
      provider,
      label: "Gemini",
      keyName: "GEMINI_API_KEY",
      model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
      endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL || "gemini-3.5-flash-lite")}:generateContent`,
    };
  if (provider === "deepseek")
    return {
      provider,
      label: "DeepSeek",
      keyName: "DEEPSEEK_API_KEY",
      model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
      endpoint: "https://api.deepseek.com/chat/completions",
    };
  if (provider === "groq")
    return {
      provider,
      label: "Groq",
      keyName: "GROQ_API_KEY",
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
    };
  throw new Error("LLM_PROVIDER must be groq, deepseek or gemini.");
}
