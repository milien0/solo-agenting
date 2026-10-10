import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import type { Capability, CapabilityContext, CapabilityEffect } from './types.js';

export const empty = z.object({}).strict();
export const short = z.string().min(1).max(1000);
export const text = z.string().max(250_000);
export const id = z.string().min(1).max(200).regex(/^[\w.-]+$/);
export const limit = z.number().int().min(1).max(100).default(20);
export const obj = (shape: z.ZodRawShape) => z.object(shape).strict();
export function define(context: CapabilityContext, name: string, description: string, category: string,
  effect: CapabilityEffect, inputSchema: z.ZodType, requiredEnv: string[], run: (input: any) => Promise<unknown> | unknown): Capability {
  return { name, description, category, effect, inputSchema, requiredEnv,
    async execute(input) {
      const parsed = inputSchema.parse(input);
      const missing = requiredEnv.filter(key => !context.env[key]?.trim());
      if (missing.length) throw new Error(`Missing configuration: ${missing.join(', ')}`);
      return run(parsed);
    } };
}
export function enabled(context: CapabilityContext, key: string) {
  if (context.env[key] !== 'true') throw new Error(`${key} must be explicitly set to true`);
}

function privateAddress(address: string): boolean {
  const a = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(a) === 4) {
    const p = a.split('.').map(Number);
    return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0]! >= 224 ||
      (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1]! >= 16 && p[1]! <= 31) ||
      (p[0] === 192 && (p[1] === 168 || p[1] === 0)) || (p[0] === 100 && p[1]! >= 64 && p[1]! <= 127) ||
      (p[0] === 198 && (p[1] === 18 || p[1] === 19 || (p[1] === 51 && p[2] === 100))) ||
      (p[0] === 192 && p[1] === 0 && p[2] === 2) || (p[0] === 203 && p[1] === 0 && p[2] === 113);
  }
  if (isIP(a) === 6) {
    if (a.startsWith('::ffff:')) return true;
    return !/^[23][0-9a-f]{3}:/.test(a) || a.startsWith('2001:db8:') || a.startsWith('2002:') || a.startsWith('2001:0:');
  }
  return false;
}
export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Only public HTTP(S) URLs without embedded credentials are allowed');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host.includes('.') && !isIP(host) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || privateAddress(host)) throw new Error('Local and private network URLs are prohibited');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let addresses: { address: string }[];
  try {
    addresses = isIP(host) ? [{ address: host }] : await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('URL DNS lookup timed out')), 5000); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
  if (!addresses.length || addresses.some(record => privateAddress(record.address))) throw new Error('URL resolves to a private or reserved address');
  return url;
}
export function redact(value: string, env: CapabilityContext['env']): string {
  let output = value;
  for (const [key, secret] of Object.entries(env)) {
    if (!secret || secret.length < 4) continue;
    if (/TOKEN|SECRET|KEY|PASSWORD/i.test(key)) {
      output = output.split(secret).join('[redacted]').split(encodeURIComponent(secret)).join('[redacted]');
    }
    if (/URL$/i.test(key)) {
      output = output.split(secret).join('[configured endpoint]');
      try {
        for (const [param, credential] of new URL(secret).searchParams) {
          if (/key|token|secret|password|auth/i.test(param) && credential.length >= 4) output = output.split(credential).join('[redacted]').split(encodeURIComponent(credential)).join('[redacted]');
        }
      } catch { /* Invalid configured URLs are reported by URL validation. */ }
    }
  }
  return output.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]');
}
export interface HttpResult { status: number; headers: Headers; text: string; data: any }
export async function request(context: CapabilityContext, url: string, init: RequestInit = {}, publicGuard = false): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    if (publicGuard) await assertPublicUrl(url);
    const response = await context.fetch(url, { ...init, redirect: 'error', signal: controller.signal });
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > 1_048_576) { await response.body?.cancel(); throw new Error('HTTP response exceeds 1 MiB'); }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 1_048_576) { await reader.cancel(); throw new Error('HTTP response exceeds 1 MiB'); }
        chunks.push(value);
      }
    }
    const body = redact(Buffer.concat(chunks).toString('utf8'), context.env);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`);
    let data: any;
    try { data = body ? JSON.parse(body) : null; } catch { data = body; }
    return { status: response.status, headers: response.headers, text: body, data };
  } catch (error) {
    throw new Error(redact(error instanceof Error ? error.message : String(error), context.env));
  } finally { clearTimeout(timer); }
}
export const qs = (values: Record<string, unknown>) => {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) q.set(key, String(value));
  return q.toString();
};
export const jsonBody = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
