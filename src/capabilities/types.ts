import type { ZodType } from 'zod';

export type CapabilityEffect = 'read' | 'write' | 'public' | 'financial';
export interface Capability {
  name: string;
  description: string;
  category: string;
  effect: CapabilityEffect;
  inputSchema: ZodType;
  requiredEnv: string[];
  execute(input: any): Promise<unknown>;
}
export interface CapabilityContext {
  workspace: string;
  env: Record<string, string | undefined>;
  runtime(operation: string, input: any): Promise<unknown>;
  fetch: typeof fetch;
}
