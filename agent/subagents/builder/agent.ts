import { defineAgent } from "eve";
import { chatgpt } from "eve/models/openai";

export default defineAgent({
  description: "Build, test, and deliver useful artifacts, software, content, and experiments within an assigned scope. Return concrete files or URLs and acceptance evidence.",
  model: process.env.MODEL_PROVIDER === "chatgpt"
    ? chatgpt((process.env.EVE_MODEL ?? "gpt-6-luna-fast").replace(/^openai\//, ""))
    : process.env.EVE_MODEL ?? "openai/gpt-6-luna-fast",
  reasoning: "high",
});
