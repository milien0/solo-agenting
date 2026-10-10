import type { Capability, CapabilityContext } from './types.js';
import { localCapabilities } from './local.js';
import { runtimeCapabilities } from './runtime.js';
import { webCapabilities } from './web.js';
import { githubCapabilities } from './github.js';
import { stripeCapabilities } from './stripe.js';
import { solanaCapabilities } from './solana.js';
import { communicationCapabilities } from './communications.js';
import { hostingCapabilities } from './hosting.js';
import { mcpCapabilities } from './mcp.js';
export type { Capability, CapabilityContext, CapabilityEffect } from './types.js';

export function createCapabilities(context: CapabilityContext): Capability[] {
  const tools = [
    ...localCapabilities(context), ...runtimeCapabilities(context), ...webCapabilities(context),
    ...githubCapabilities(context), ...stripeCapabilities(context), ...solanaCapabilities(context),
    ...communicationCapabilities(context), ...hostingCapabilities(context), ...mcpCapabilities(context),
  ];
  if (new Set(tools.map(tool => tool.name)).size !== tools.length) throw new Error('Duplicate capability names');
  return tools;
}
