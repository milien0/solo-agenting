import { defineTool } from 'eve/tools';
import { z } from 'zod';

async function request(path:string,input:unknown) {
  const host=process.env.SOLO_RUNTIME_URL || 'http://127.0.0.1:4310';
  const token=process.env.SOLO_API_TOKEN;
  if(!token)throw new Error('The Solo Agentic supervisor must be running to use its capabilities');
  const response=await fetch(`${host}${path}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(input),signal:AbortSignal.timeout(30000)});
  const body=await response.json() as {error?:string;result?:unknown};
  if(!response.ok)throw new Error(body.error || `Capability request failed (${response.status})`);
  return body.result;
}
export const discover=defineTool({
  description:'Search the Solo Agentic capability library. Returns availability, required configuration and exact input schemas. Discover relevant tools before calling execute; optional category/name narrows the list.',
  inputSchema:z.object({query:z.string().optional(),category:z.string().optional(),name:z.string().optional(),limit:z.number().int().min(1).max(30).default(12)}),
  execute:input=>request('/api/internal/discover',input),
});
export const execute=defineTool({
  description:'Execute a discovered Solo Agentic capability using its exact schema. For external mutations provide a stable idempotencyKey and retain it across retry/recovery. Never replace a key after an uncertain outcome. Missing credentials are a setup dependency, not success.',
  inputSchema:z.object({name:z.string().min(1),input:z.record(z.string(),z.unknown()),idempotencyKey:z.string().min(8).max(200).optional()}),
  execute:input=>request('/api/internal/execute',input),
});
export async function reconcileReceipts() { return request('/api/internal/reconcile',{}); }
