import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { MessageStreamEvent } from 'eve/client';
import { getConfig, type Config } from '../src/config.js';
import { Store } from '../src/store.js';
import { Runtime } from '../src/runtime.js';
import { Supervisor, classifyEvents } from '../src/supervisor.js';
import { createHttpServer } from '../src/http.js';

function fixture(t: TestContext, overrides: Partial<Config> = {}, env: Record<string, string | undefined> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'solo-runtime-'));
  const config: Config = { ...getConfig(root), root, host: '127.0.0.1', dataDir: join(root, 'data'), workspace: join(root, 'workspace'), apiToken: 'owner_test_token', internalToken: 'agent_test_token', autoEve: false, enablePublicActions: false, enableFinancialActions: false, ...overrides };
  const store = new Store(join(config.dataDir, 'test.sqlite'));
  const runtime = new Runtime(config, env, store);
  t.after(() => {
    try { store.close(); } finally {
      assert.equal(dirname(resolve(root)), resolve(tmpdir()), 'test cleanup must remain in the named temporary parent');
      assert.ok(basename(root).startsWith('solo-runtime-'), 'test cleanup must target its own named fixture');
      rmSync(root, { recursive: true, force: true });
    }
  });
  return { root, config, store, runtime };
}
function replaceFetch(t: TestContext, fetcher: typeof fetch) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetcher;
  t.after(() => { globalThis.fetch = previous; });
}
const githubInput = { owner: 'milien0', repo: 'solo-agenting', title: 'Test issue', body: 'Test only' };
const stream = (...items: [string, any][]) => items.map(([type, data]) => ({ type, data })) as MessageStreamEvent[];

test('public effects require enabled policy, valid input and stable idempotency before a provider call', async t => {
  let calls = 0;
  replaceFetch(t, async () => { calls++; return Response.json({ number: 7 }); });
  const { runtime, config } = fixture(t, {}, { GITHUB_TOKEN: 'test_github_token' });
  await assert.rejects(runtime.execute('github_issue_create', githubInput, 'public-issue-001'), /ENABLE_PUBLIC_ACTIONS/);
  config.enablePublicActions = true;
  await assert.rejects(runtime.execute('github_issue_create', { ...githubInput, title: '' }, 'public-issue-001'));
  await assert.rejects(runtime.execute('github_issue_create', githubInput), /stable idempotencyKey/);
  assert.equal(calls, 0);
  assert.deepEqual(await runtime.execute('github_issue_create', githubInput, 'public-issue-001'), { number: 7 });
  assert.deepEqual(await runtime.execute('github_issue_create', { body: 'Test only', title: 'Test issue', repo: 'solo-agenting', owner: 'milien0' }, 'public-issue-001'), { number: 7 });
  assert.equal(calls, 1, 'reordered equivalent inputs reuse the same completed result');
  await assert.rejects(runtime.execute('github_issue_create', { ...githubInput, title: 'Changed intent' }, 'public-issue-001'), /different|conflict|changed|mismatch/i);
  assert.equal(calls, 1);
  config.enablePublicActions = false;
  runtime.store.setSetting('paused', true);
  delete runtime.env.GITHUB_TOKEN;
  assert.deepEqual(await runtime.execute('github_issue_create', githubInput, 'public-issue-001'), { number: 7 }, 'completed results remain inspectable after pause and credential removal');
  assert.equal(calls, 1);
});

test('concurrent identical mutations cannot both reach the provider', async t => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  replaceFetch(t, async () => { calls++; await gate; return Response.json({ number: 9 }); });
  const { runtime } = fixture(t, { enablePublicActions: true }, { GITHUB_TOKEN: 'test_github_token' });
  const first = runtime.execute('github_issue_create', githubInput, 'concurrent-issue-001');
  try {
    await assert.rejects(runtime.execute('github_issue_create', githubInput, 'concurrent-issue-001'), /uncertain|failed outcome/);
    assert.equal(calls, 1);
  } finally { release(); await first; }
});

test('uncertain provider outcomes are persisted and never replayed automatically', async t => {
  let calls = 0;
  replaceFetch(t, async () => { calls++; throw new Error('Connection ended after provider acceptance'); });
  const { runtime, store } = fixture(t, { enablePublicActions: true }, { GITHUB_TOKEN: 'test_github_token' });
  await assert.rejects(runtime.execute('github_issue_create', githubInput, 'uncertain-issue-001'), /Connection ended/);
  assert.equal(store.toolCall('github_issue_create:uncertain-issue-001')?.status, 'uncertain');
  await assert.rejects(runtime.execute('github_issue_create', githubInput, 'uncertain-issue-001'), /uncertain|failed outcome/);
  assert.equal(calls, 1);
});

test('completed external results survive process restart and are not sent twice', async t => {
  let calls = 0;
  replaceFetch(t, async () => { calls++; return Response.json({ number: 17, html_url: 'https://github.com/example/repo/issues/17' }); });
  const { runtime, root, config, store } = fixture(t, { enablePublicActions: true }, { GITHUB_TOKEN: 'test_github_token' });
  const first = await runtime.execute('github_issue_create', githubInput, 'persistent-issue-001');
  const reopenedStore = new Store(join(config.dataDir, 'test.sqlite'));
  try {
    const restarted = new Runtime(config, { GITHUB_TOKEN: 'test_github_token' }, reopenedStore);
    assert.deepEqual(await restarted.execute('github_issue_create', githubInput, 'persistent-issue-001'), first);
    assert.equal(calls, 1);
    assert.equal(reopenedStore.tasks().length, store.tasks().length, 'restart does not duplicate bootstrap work');
    assert.ok(root);
  } finally { reopenedStore.close(); }
});

test('false permission flags are unavailable even with valid provider credentials', async t => {
  const { runtime } = fixture(t, { enablePublicActions: true, enableFinancialActions: true }, { GMAIL_ACCESS_TOKEN: 'test_mail_token', GMAIL_SEND_ENABLED: 'false', STRIPE_SECRET_KEY: 'test_stripe_token', STRIPE_CATALOG_WRITE_ENABLED: 'false' });
  const gmail = runtime.tools().find(tool => tool.name === 'gmail_send')!;
  const stripe = runtime.tools().find(tool => tool.name === 'stripe_product_create')!;
  assert.equal(gmail.available, false);
  assert.ok(gmail.missingEnv.some(value => value.includes('GMAIL_SEND_ENABLED')));
  assert.equal(stripe.available, false);
  await assert.rejects(runtime.execute('gmail_send', { to: 'buyer@example.com', subject: 'Hi', body: 'Hello' }, 'send-disabled-001'), /GMAIL_SEND_ENABLED/);
});

test('paused mutation gate still permits reads and financial reports never count as receipts', async t => {
  const { runtime, store } = fixture(t);
  runtime.startChallenge();
  const record: any = await runtime.execute('ledger_record', { type: 'income', amountUsd: 1000, description: 'Agent-reported sale', externalRef: 'reported:income001' });
  assert.equal(record.verified, false);
  assert.equal(record.countsTowardChallenge, false);
  assert.equal(runtime.challenge().revenueUsd, 0);
  assert.equal(runtime.challenge().fundingUsd, 0);
  assert.equal(runtime.challenge().status, 'running');
  store.setSetting('paused', true);
  await assert.rejects(runtime.execute('memory_save', { key: 'new', content: 'No mutation' }), /paused/);
  const overview: any = await runtime.execute('challenge_overview', {});
  assert.equal(overview.revenueUsd, 0);
  await assert.rejects(runtime.execute('nonexistent_capability', {}), /Unknown capability/);
  await assert.rejects(runtime.operation('ledger.verify', {}), /Unknown runtime operation/);
});

test('task updates cannot invent completed work or interfere with a live durable session', async t => {
  const { runtime, store } = fixture(t);
  const queued = store.enqueue({ title: 'Real work', role: 'builder' });
  await assert.rejects(runtime.execute('task_update', { id: queued.id, status: 'completed' }), /queued|cancelled|harness/);
  store.updateTask(queued.id, { status: 'running', sessionId: 'durable-accepted-session' });
  await assert.rejects(runtime.execute('task_update', { id: queued.id, status: 'queued' }), /harness owns active/);
  assert.equal(store.task(queued.id)?.status, 'running');
});

test('expired leases recover existing accepted sessions instead of enqueuing their external actions again', async t => {
  const { runtime, store } = fixture(t, {}, { AI_GATEWAY_API_KEY: 'test_model_token' });
  for (const task of store.tasks()) store.updateTask(task.id, { status: 'cancelled' });
  const task = store.enqueue({ title: 'Already accepted work', role: 'operator' });
  store.updateTask(task.id, { status: 'running', sessionId: 'persisted-session-123', attempts: 1, leaseUntil: new Date(Date.now() - 1000).toISOString() });
  store.setSetting('scheduler.lastCycleMs', Date.now());
  const supervisor = new Supervisor(runtime);
  const attached: string[] = [];
  let created = 0;
  (supervisor as any).client = { fetch: async () => new Response('{}', { status: 200 }), sessions: { attach: (sessionId: string) => { attached.push(sessionId); return { snapshot: async () => ({ session: { streamIndex: 8 }, events: stream(['message.completed', { message: 'Evidence stored' }], ['turn.completed', {}]) }) }; }, create: async () => { created++; throw new Error('Must not recreate accepted work'); } } };
  await supervisor.tick();
  assert.deepEqual(attached, ['persisted-session-123']);
  assert.equal(created, 0);
  assert.equal(store.task(task.id)?.status, 'completed');
  assert.equal(store.task(task.id)?.attempts, 1);
  assert.equal(store.task(task.id)?.result, 'Evidence stored');
  assert.equal(store.task(task.id)?.streamIndex, 8);
});

test('unavailable durable sessions require attention and do not silently start new sessions', async t => {
  const { runtime, store } = fixture(t, {}, { AI_GATEWAY_API_KEY: 'test_model_token' });
  for (const task of store.tasks()) store.updateTask(task.id, { status: 'cancelled' });
  const task = store.enqueue({ title: 'Inspect uncertain delivery', role: 'operator' });
  store.updateTask(task.id, { status: 'running', sessionId: 'persisted-session-gone', attempts: 1, leaseUntil: new Date(Date.now() - 1000).toISOString() });
  store.setSetting('scheduler.lastCycleMs', Date.now());
  const supervisor = new Supervisor(runtime);
  let created = 0;
  (supervisor as any).client = { fetch: async () => new Response('{}', { status: 200 }), sessions: { attach: () => ({ snapshot: async () => { throw new Error('Session missing'); } }), create: async () => { created++; throw new Error('No replay'); } } };
  await supervisor.tick();
  assert.equal(store.task(task.id)?.status, 'needs_attention');
  assert.equal(created, 0);
  assert.equal(store.tasks('queued').length, 0);
});

test('durable event classification follows current work instead of historical terminal events', () => {
  assert.equal(classifyEvents(stream(['turn.started', {}])).status, 'recovering');
  assert.equal(classifyEvents(stream(['message.completed', { message: 'Done' }], ['turn.completed', {}])).status, 'completed');
  assert.equal(classifyEvents(stream(['turn.failed', { error: 'Old failure' }], ['turn.completed', {}])).status, 'completed');
  assert.equal(classifyEvents(stream(['turn.completed', {}], ['turn.waiting', { on: 'input' }])).status, 'needs_attention');
  assert.equal(classifyEvents(stream(['turn.completed', {}], ['turn.failed', { error: 'Current failure' }])).status, 'needs_attention');
  assert.equal(classifyEvents(stream(['turn.completed', {}], ['turn.cancelled', {}])).status, 'needs_attention');
  assert.equal(classifyEvents(stream(['turn.completed', {}], ['turn.started', {}])).status, 'recovering');
  assert.equal(classifyEvents(stream(['turn.completed', {}], ['turn.waiting', { on: 'tasks' }])).status, 'recovering');
});

test('expired or successful challenges preserve queued work without dispatching further earning sessions', async t => {
  for (const status of ['expired', 'succeeded'] as const) {
    const { runtime, store } = fixture(t, {}, { AI_GATEWAY_API_KEY: 'test_model_token' });
    for (const task of store.tasks()) store.updateTask(task.id, { status: 'cancelled' });
    if (status === 'expired') store.setSetting('challenge.startedAt', new Date(Date.now() - 31 * 86400_000).toISOString());
    else { runtime.startChallenge(); store.ledgerRecord({ type: 'income', amountUsd: 1000, description: 'Owner verified receipts', externalRef: 'owner:target-receipts' }, true, 'owner'); }
    assert.equal(runtime.challenge().status, status);
    const pending = store.enqueue({ title: 'Queued earning work', role: 'operator' });
    store.setSetting('scheduler.lastCycleMs', Date.now());
    const supervisor = new Supervisor(runtime);
    let created = 0;
    (supervisor as any).client = { fetch: async () => new Response('{}', { status: 200 }), sessions: { create: async () => { created++; throw new Error('Terminal challenge must not dispatch'); } } };
    await supervisor.tick();
    assert.equal(created, 0);
    assert.equal(store.task(pending.id)?.status, 'queued');
    assert.equal(store.task(pending.id)?.attempts, 0);
  }
});

test('gateway dispatch reserves the session allowance for active work before claiming another task', async t => {
  const { runtime, store } = fixture(t, { modelProvider: 'gateway', maxWorkers: 3, maxSessionCostUsd: 1, maxTotalModelCostUsd: 2 }, { AI_GATEWAY_API_KEY: 'test_model_token' });
  for (const task of store.tasks()) store.updateTask(task.id, { status: 'cancelled' });
  store.put('model_cost', { amountUsd: 0.5 }, 'previous-priced-session');
  const active = store.enqueue({ title: 'Accepted active work', role: 'builder' });
  store.updateTask(active.id, { status: 'running', sessionId: 'accepted-active-session', leaseUntil: new Date(Date.now() + 60_000).toISOString() });
  const pending = store.enqueue({ title: 'Next paid work', role: 'researcher' });
  store.setSetting('scheduler.lastCycleMs', Date.now());
  const supervisor = new Supervisor(runtime);
  supervisor.active.set(active.id, new AbortController());
  let created = 0;
  (supervisor as any).client = { fetch: async () => new Response('{}', { status: 200 }), sessions: { create: async () => { created++; throw new Error('Reserved model budget must prevent another session'); } } };
  await supervisor.tick();
  await supervisor.tick();
  assert.equal(created, 0);
  assert.equal(store.task(pending.id)?.status, 'queued');
  assert.equal(store.task(pending.id)?.attempts, 0);
  assert.equal(supervisor.status().mode, 'model_budget_limit');
  assert.equal(store.events().filter(event => event.type === 'model.budget_limit').length, 1, 'unchanged budget exhaustion is recorded once');
});

test('gateway budget includes older model charges beyond the 500-row display limit', async t => {
  const { runtime, store } = fixture(t, { modelProvider: 'gateway', maxSessionCostUsd: 1, maxTotalModelCostUsd: 12.5 }, { AI_GATEWAY_API_KEY: 'test_model_token' });
  for (const task of store.tasks()) store.updateTask(task.id, { status: 'cancelled' });
  store.put('model_cost', { amountUsd: 7 }, 'old-but-billable-session');
  for (let i = 0; i < 504; i++) store.put('model_cost', { amountUsd: 0.01 }, `recent-session-${i}`);
  assert.equal(store.list('model_cost', 500).length, 500);
  const pending = store.enqueue({ title: 'Do not omit earlier billing', role: 'operator' });
  store.setSetting('scheduler.lastCycleMs', Date.now());
  const supervisor = new Supervisor(runtime);
  let created = 0;
  (supervisor as any).client = { fetch: async () => new Response('{}', { status: 200 }), sessions: { create: async () => { created++; throw new Error('All historical billed costs must be counted'); } } };
  await supervisor.tick();
  assert.equal(created, 0);
  assert.equal(store.task(pending.id)?.status, 'queued');
  assert.equal(store.task(pending.id)?.attempts, 0);
  assert.ok(Math.abs(supervisor.status().modelCostUsd! - 12.04) < 1e-9);
  assert.equal(supervisor.status().modelCostReporting, 'provider_reported');
  assert.equal(supervisor.status().mode, 'model_budget_limit');
});

async function httpFixture(t: TestContext) {
  const base = fixture(t, { port: 0 });
  const supervisor = new Supervisor(base.runtime);
  const server = createHttpServer(base.runtime, supervisor);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base.config.port = (server.address() as AddressInfo).port;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const send = (route: string, method = 'GET', headers: Record<string, string> = {}, body?: unknown) => new Promise<{ status: number; body: any }>((resolve, reject) => {
    const content = body === undefined ? '' : JSON.stringify(body);
    const req = httpRequest({ host: '127.0.0.1', port: base.config.port, path: route, method, headers: { Host: `127.0.0.1:${base.config.port}`, Connection: 'close', ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(content)) }), ...headers } }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject); req.end(content);
  });
  return { ...base, send };
}

test('HTTP refuses hostile Host, missing auth, cross-origin CSRF and cookie-only internal access', async t => {
  const { send, config } = await httpFixture(t);
  assert.equal((await send('/healthz', 'GET', { Host: 'evil.example:4310' })).status, 403);
  assert.equal((await send('/api/status')).status, 401);
  assert.equal((await send('/api/status', 'GET', { Cookie: `solo_session=${config.apiToken}` })).status, 200);
  const input = { title: 'Unauthorized task' };
  assert.equal((await send('/api/tasks', 'POST', { Cookie: `solo_session=${config.apiToken}`, Origin: 'https://evil.example' }, input)).status, 403);
  assert.equal((await send('/api/tasks', 'POST', { Cookie: `solo_session=${config.apiToken}` }, input)).status, 403);
  assert.equal((await send('/api/internal/execute', 'POST', { Cookie: `solo_session=${config.apiToken}`, Origin: `http://127.0.0.1:${config.port}` }, { name: 'time_now', input: {} })).status, 401);
  assert.equal((await send('/api/internal/execute', 'POST', { Authorization: `Bearer ${config.internalToken}` }, { name: 'time_now', input: {} })).status, 200);
  assert.equal((await send('/api/tasks', 'POST', { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'text/plain' }, input)).status, 415);
});

test('internal agent authority cannot attest owner revenue but authenticated owner can record evidence', async t => {
  const { send, config, runtime } = await httpFixture(t);
  runtime.startChallenge();
  const receipt = { type: 'income', amountUsd: 10, description: 'Explicit owner evidence', externalRef: 'owner:http001' };
  assert.equal((await send('/api/ledger', 'POST', { Authorization: `Bearer ${config.internalToken}` }, receipt)).status, 401);
  assert.equal(runtime.challenge().revenueUsd, 0);
  const accepted = await send('/api/ledger', 'POST', { Cookie: `solo_session=${config.apiToken}`, Origin: `http://127.0.0.1:${config.port}` }, receipt);
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.verified, true);
  assert.equal(runtime.challenge().revenueUsd, 10);
});

test('owner-confirmed refunds preserve their receipt linkage and cannot count as new revenue', async t => {
  const { send, config, runtime } = await httpFixture(t);
  runtime.startChallenge();
  const headers = { Cookie: `solo_session=${config.apiToken}`, Origin: `http://127.0.0.1:${config.port}` };
  const receipt = { type: 'income', amountUsd: 10, description: 'Owner verified sale', externalRef: 'owner:refund-sale' };
  assert.equal((await send('/api/ledger', 'POST', headers, receipt)).status, 201);
  const refund = { type: 'refund', amountUsd: 4, description: 'Successful customer return', externalRef: 'owner:refund001', relatedRef: receipt.externalRef };
  const accepted = await send('/api/ledger', 'POST', headers, refund);
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.relatedRef, receipt.externalRef);
  assert.equal(runtime.challenge().grossReceiptsUsd, 10);
  assert.equal(runtime.challenge().refundUsd, 4);
  assert.equal(runtime.challenge().revenueUsd, 6);
  assert.equal((await send('/api/ledger', 'POST', headers, refund)).status, 201);
  assert.equal(runtime.challenge().revenueUsd, 6, 'duplicate refund evidence is counted once');
  const unlinked = { type: 'refund', amountUsd: 1, description: 'Missing linked receipt', externalRef: 'owner:refund-missing' };
  assert.equal((await send('/api/ledger', 'POST', headers, unlinked)).status, 400);
});

test('HTTP fails closed for blank or shared owner and internal tokens', t => {
  const { runtime, config } = fixture(t);
  config.apiToken = '';
  assert.throws(() => createHttpServer(runtime, new Supervisor(runtime)), /nonempty/);
  config.apiToken = config.internalToken;
  assert.throws(() => createHttpServer(runtime, new Supervisor(runtime)), /distinct/);
});
