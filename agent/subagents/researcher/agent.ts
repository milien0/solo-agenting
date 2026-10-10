import { defineAgent } from "eve";
import { chatgpt } from "eve/models/openai";

export default defineAgent({
  description: "Research current opportunities, buyer needs, platform requirements, and uncertain claims. Return sourced evidence and a concrete low-cost next test without choosing a strategy in advance.",
  model: process.env.MODEL_PROVIDER === "chatgpt"
    ? chatgpt((process.env.EVE_MODEL ?? "gpt-6-luna-fast").replace(/^openai\//, ""))
    : process.env.EVE_MODEL ?? "openai/gpt-6-luna-fast",
  reasoning: "high",
});
