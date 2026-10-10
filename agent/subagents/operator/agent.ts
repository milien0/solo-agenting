import { defineAgent } from "eve";
import { chatgpt } from "eve/models/openai";

export default defineAgent({
  description: "Operate authorized customer and platform workflows: listings, outreach, orders, delivery, support, and account readiness. Record actual provider outcomes and customer obligations.",
  model: process.env.MODEL_PROVIDER === "chatgpt"
    ? chatgpt((process.env.EVE_MODEL ?? "gpt-6-luna-fast").replace(/^openai\//, ""))
    : process.env.EVE_MODEL ?? "openai/gpt-6-luna-fast",
  reasoning: "high",
});
