import { defineAgent } from "eve";
import { chatgpt } from "eve/models/openai";

export default defineAgent({
  description: "Independently reconcile gross customer receipts, wallet/card assets, expenses, refunds, and commitments against real provider evidence. Flag unverified claims, duplicate entries, and funds unavailable to spend.",
  model: process.env.MODEL_PROVIDER === "chatgpt"
    ? chatgpt((process.env.EVE_MODEL ?? "gpt-6-luna-fast").replace(/^openai\//, ""))
    : process.env.EVE_MODEL ?? "openai/gpt-6-luna-fast",
  reasoning: "high",
});
