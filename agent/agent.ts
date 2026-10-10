import { defineAgent } from 'eve';
import { chatgpt } from 'eve/models/openai';

export default defineAgent({
  description: 'Solo Agentic: coordinate an evidence-driven earning challenge with a persistent swarm and discoverable tool library.',
  model: process.env.MODEL_PROVIDER === 'chatgpt'
    ? chatgpt((process.env.EVE_MODEL || 'gpt-6-luna-fast').replace(/^openai\//,''))
    : process.env.EVE_MODEL || 'openai/gpt-6-luna-fast',
  reasoning: 'high',
  limits: {
    maxInputTokensPerSession: 200000,
    maxOutputTokensPerSession: 16000,
    maxTokenCostUsdPerSession: Number(process.env.MAX_SESSION_COST_USD || 1),
    sessionTimeoutMs: 86400000,
  },
});
