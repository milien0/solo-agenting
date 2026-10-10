import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

export function loadEnvironment(root = process.cwd()) {
  // Node preserves existing values: process environment > .env.local > .env.
  for (const name of ['.env.local', '.env']) {
    const path = resolve(root, name);
    if (existsSync(path)) process.loadEnvFile(path);
  }
}

export function loadLocalCredentials() {
  if(process.env.GITHUB_AUTH_FROM_GH==='true'&&!process.env.GITHUB_TOKEN) {
    try {
      process.env.GITHUB_TOKEN=execFileSync('gh',['auth','token'],{encoding:'utf8',timeout:10000,windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();
    } catch { /* A missing CLI session remains a visible connector setup dependency. */ }
  }
}

function numberEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`);
  return value;
}

export function getConfig(root = process.cwd()) {
  return {
    root,
    host: process.env.HOST || '127.0.0.1',
    port: numberEnv('PORT', 4310, 1024, 65535),
    evePort: numberEnv('EVE_PORT', 2000, 1024, 65535),
    dataDir: resolve(root, process.env.DATA_DIR || 'data'),
    workspace: resolve(root, process.env.WORKSPACE_DIR || 'workspace'),
    vaultDir: resolve(process.env.SOLO_VAULT_DIR || resolve(homedir(),'.solo-agentic','vault')),
    modelProvider: process.env.MODEL_PROVIDER || 'gateway',
    tickSeconds: numberEnv('TICK_SECONDS', 900, 15, 86400),
    maxWorkers: numberEnv('MAX_WORKERS', 3, 1, 8),
    taskTimeoutMs: numberEnv('TASK_TIMEOUT_SECONDS', 900, 30, 3600) * 1000,
    initialCapitalUsd: numberEnv('INITIAL_CAPITAL_USD', 200, 0, 1000000),
    targetUsd: numberEnv('TARGET_REVENUE_USD', 1000, 1, 10000000),
    durationDays: numberEnv('CHALLENGE_DAYS', 30, 1, 365),
    maxSessionCostUsd: numberEnv('MAX_SESSION_COST_USD', 1, 0.01, 100),
    maxTotalModelCostUsd: numberEnv('MAX_TOTAL_MODEL_COST_USD', 20, 0.01, 1000000),
    apiToken: process.env.SOLO_API_TOKEN || '',
    internalToken: process.env.SOLO_INTERNAL_TOKEN || '',
    autoEve: process.env.AUTO_START_EVE !== 'false',
    enablePublicActions: process.env.ENABLE_PUBLIC_ACTIONS === 'true',
    enableFinancialActions: process.env.ENABLE_FINANCIAL_ACTIONS === 'true',
  };
}
export type Config = ReturnType<typeof getConfig>;
