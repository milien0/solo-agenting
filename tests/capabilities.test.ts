import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCapabilities, type CapabilityContext } from '../src/capabilities/index.js';
import { assertPublicUrl, request } from '../src/capabilities/shared.js';

function context(overrides: Partial<CapabilityContext> = {}): CapabilityContext {
  return { workspace: process.cwd(), env: {}, runtime: async (operation, input) => ({ operation, input }), fetch: async () => { throw new Error('Unexpected network request'); }, ...overrides };
}
function tool(name: string, c = context()) {
  const result = createCapabilities(c).find(t => t.name === name);
  assert.ok(result, `Missing ${name}`);
  return result;
}
test('tool discovery has unique names, schemas and honest credential requirements', () => {
  const tools = createCapabilities(context());
  assert.ok(tools.length >= 100);
  assert.equal(new Set(tools.map(t => t.name)).size, tools.length);
  for (const t of tools) { assert.match(t.name, /^[a-z][a-z0-9_]+$/); assert.ok(t.inputSchema); assert.ok(t.description); }
  assert.deepEqual(tool('stripe_balance').requiredEnv, ['STRIPE_SECRET_KEY']);
  assert.deepEqual(tool('gmail_send').requiredEnv, ['GMAIL_ACCESS_TOKEN', 'GMAIL_SEND_ENABLED']);
});
test('invalid input and missing credentials fail before any network request', async () => {
  await assert.rejects(tool('github_issue_create').execute({ owner: 'a', repo: 'b', title: 'Title', body: 'Body' }), /Missing configuration: GITHUB_TOKEN/);
  await assert.rejects(tool('calculate').execute({ operation: 'sum', values: [1, Infinity] }));
  await assert.rejects(tool('calculate').execute({ operation: 'divide', values: [1, 0] }), /Division by zero/);
  await assert.rejects(tool('time_now').execute({ surprise: true }));
  await assert.rejects(tool('github_contents_write', context({ env: { GITHUB_TOKEN: 'token1234' } })).execute({ owner: 'o', repo: 'r', path: '../../other', content: 'test', message: 'test' }), /Repository path/);
});
test('workspace file writes are confined, explicit about overwrites, and support symlink checks', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'solo-tools-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'solo-outside-'));
  try {
    const c = context({ workspace: root });
    await tool('workspace_write', c).execute({ path: 'artifacts/hello.txt', content: 'Hello' });
    assert.equal(await readFile(path.join(root, 'artifacts/hello.txt'), 'utf8'), 'Hello');
    await assert.rejects(tool('workspace_write', c).execute({ path: 'artifacts/hello.txt', content: 'Replace' }), /EEXIST/);
    await assert.rejects(tool('workspace_write', c).execute({ path: '../escaped.txt', content: 'No' }), /relative|parent/);
    await assert.rejects(tool('workspace_read', c).execute({ path: '.env' }), /hidden/);
    await assert.rejects(tool('workspace_write', c).execute({ path: 'file.txt:secret', content: 'No' }), /relative/);
    await assert.rejects(tool('workspace_write', c).execute({ path: 'NUL.txt', content: 'No' }), /device/);
    await assert.rejects(tool('workspace_write', c).execute({ path: 'artifacts./hello.txt', content: 'No' }), /relative/);
    await mkdir(path.join(outside, 'other'));
    await writeFile(path.join(outside, 'other/private.txt'), 'private');
    await symlink(path.join(outside, 'other'), path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(tool('workspace_read', c).execute({ path: 'linked/private.txt' }), /Symlink path escapes/);
    await mkdir(path.join(root, '.private'));
    await writeFile(path.join(root, '.private/secret.txt'), 'private');
    await symlink(path.join(root, '.private'), path.join(root, 'hidden-link'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(tool('workspace_read', c).execute({ path: 'hidden-link/secret.txt' }), /hidden workspace/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
test('CSV parses quoted delimiters and multiline values and rejects malformed quotes', async () => {
  assert.deepEqual(await tool('csv_parse').execute({ text: 'name,note\r\n"A,B","one\n""two"""\r\n' }), [['name', 'note'], ['A,B', 'one\n"two"']]);
  await assert.rejects(tool('csv_parse').execute({ text: '"unclosed' }), /Unterminated/);
  await assert.rejects(tool('csv_parse').execute({ text: '"closed"junk' }), /Invalid CSV/);
});
test('GitHub mutation adapter sends the intended request using only configured credentials', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const c = context({ env: { GITHUB_TOKEN: 'secret-token' }, fetch: async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ number: 7 }); } });
  assert.deepEqual(await tool('github_issue_create', c).execute({ owner: 'milien0', repo: 'solo-agenting', title: 'Test', body: 'Review' }), { number: 7 });
  assert.equal(calls[0]?.url, 'https://api.github.com/repos/milien0/solo-agenting/issues');
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.equal(new Headers(calls[0]?.init?.headers).get('authorization'), 'Bearer secret-token');
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { title: 'Test', body: 'Review' });
});
test('Stripe sales links verify exact price before creating a link and reject recurring prices', async () => {
  const calls: string[] = [];
  const c = context({ env: { STRIPE_SECRET_KEY: 'stripe-secret', STRIPE_CATALOG_WRITE_ENABLED: 'true' }, fetch: async (url, init) => { calls.push(String(url)); if (String(url).includes('/prices/')) return Response.json({ active: true, type: 'recurring', unit_amount: 500, currency: 'usd' }); assert.fail(`Unexpected mutation ${init?.method}`); } });
  await assert.rejects(tool('stripe_payment_link_create', c).execute({ price: 'price_test', quantity: 1, expectedUnitAmount: 500, currency: 'usd', idempotencyKey: 'idempotent-123' }), /does not match/);
  assert.equal(calls.length, 1);
});
test('Stripe payment link request uses validated amount, form encoding and idempotency', async () => {
  let mutation: RequestInit | undefined;
  const c = context({ env: { STRIPE_SECRET_KEY: 'stripe-secret', STRIPE_CATALOG_WRITE_ENABLED: 'true' }, fetch: async (url, init) => { if (String(url).includes('/prices/')) return Response.json({ active: true, type: 'one_time', unit_amount: 500, currency: 'usd' }); mutation = init; return Response.json({ url: 'https://buy.stripe.com/example' }); } });
  await tool('stripe_payment_link_create', c).execute({ price: 'price_test', quantity: 2, expectedUnitAmount: 500, currency: 'usd', idempotencyKey: 'idempotent-123' });
  assert.equal(new URLSearchParams(String(mutation?.body)).get('line_items[0][quantity]'), '2');
  assert.equal(new Headers(mutation?.headers).get('idempotency-key'), 'idempotent-123');
});
test('Solana adapter is read-only and reports lamports separately from SOL', async () => {
  let method: string | undefined;
  const c = context({ env: { SOLANA_RPC_URL: 'https://1.1.1.1/rpc' }, fetch: async (_url, init) => { method = JSON.parse(String(init?.body)).method; return Response.json({ jsonrpc: '2.0', id: 1, result: { context: { slot: 10 }, value: 1_500_000_000 } }); } });
  const result: any = await tool('solana_balance', c).execute({ address: '11111111111111111111111111111111' });
  assert.equal(method, 'getBalance'); assert.equal(result.sol, 1.5); assert.equal(result.lamports, 1_500_000_000);
  assert.ok(createCapabilities(c).filter(t => t.category === 'solana').every(t => t.effect === 'read'));
});
test('outbound communications require true flags and encode MIME without header injection', async () => {
  const c = context({ env: { GMAIL_ACCESS_TOKEN: 'gmail-secret', GMAIL_SEND_ENABLED: 'false' } });
  await assert.rejects(tool('gmail_send', c).execute({ to: 'buyer@example.com', subject: 'Offer', body: 'Hello' }), /explicitly set to true/);
  await assert.rejects(tool('gmail_send', c).execute({ to: 'buyer@example.com', subject: 'Offer\r\nBcc: other@example.com', body: 'Hello' }));
  let raw = '';
  const working = context({ env: { GMAIL_ACCESS_TOKEN: 'gmail-secret', GMAIL_SEND_ENABLED: 'true' }, fetch: async (_url, init) => { raw = JSON.parse(String(init?.body)).raw; return Response.json({ id: 'message123' }); } });
  await tool('gmail_send', working).execute({ to: 'buyer@example.com', subject: 'Résumé', body: 'Hello world' });
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(decoded, /To: buyer@example.com\r\n/); assert.match(decoded, /Subject: =\?UTF-8\?B\?/);
  assert.match(decoded, new RegExp(Buffer.from('Hello world').toString('base64')));
});
test('HTTP adapter caps response size, refuses redirects, and redacts credential errors', async () => {
  const c = context({ env: { GITHUB_TOKEN: 'token1234' }, fetch: async (_url, init) => { assert.equal(init?.redirect, 'error'); return new Response('Bearer token1234', { status: 401 }); } });
  await assert.rejects(request(c, 'https://api.github.com/user'), e => e instanceof Error && !e.message.includes('token1234') && e.message.includes('[redacted]'));
  const big = context({ fetch: async () => new Response('body', { headers: { 'Content-Length': '2000000' } }) });
  await assert.rejects(request(big, 'https://api.github.com/user'), /exceeds 1 MiB/);
});
test('public URL guard rejects loopback, cloud metadata, private IPv6 and embedded credentials', async () => {
  for (const url of ['http://localhost/a', 'http://127.0.0.1/', 'http://169.254.169.254/', 'http://10.0.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[64:ff9b::a00:1]/', 'http://203.0.113.1/', 'https://user:pass@example.com', 'file:///tmp/a']) await assert.rejects(assertPublicUrl(url));
});
test('runtime financial declarations remain evidence requests and require an external reference', async () => {
  const c = context();
  assert.equal(tool('ledger_record', c).effect, 'financial');
  await assert.rejects(tool('ledger_record', c).execute({ type: 'income', amountUsd: 1000, description: 'Claim' }));
  const result: any = await tool('ledger_record', c).execute({ type: 'income', amountUsd: 10, description: 'Invoice payment', externalRef: 'ch_actual123' });
  assert.equal(result.operation, 'ledger.record'); assert.equal(result.input.externalRef, 'ch_actual123');
});
test('MCP tool calls enforce an explicit owner allowlist before initialization', async () => {
  const c = context({ env: { MCP_SERVER_URL: 'https://1.1.1.1/mcp', MCP_ALLOWED_TOOLS: 'read_catalog' } });
  await assert.rejects(tool('mcp_tool_call', c).execute({ name: 'arbitrary_tool', arguments: {} }), /not in MCP_ALLOWED_TOOLS/);
});
test('MCP handshake reuses a session and admits only discovered read-only tools', async () => {
  const methods: string[] = [];
  const c = context({ env: { MCP_SERVER_URL: 'https://1.1.1.1/mcp', MCP_ALLOWED_TOOLS: 'read_catalog,write_catalog' }, fetch: async (_url, init) => {
    const input = JSON.parse(String(init?.body));
    methods.push(input.method);
    const headers = new Headers(init?.headers);
    if (input.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: input.id, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'test', version: '1' } } }, { headers: { 'Mcp-Session-Id': 'session123' } });
    assert.equal(headers.get('Mcp-Session-Id'), 'session123');
    assert.equal(headers.get('MCP-Protocol-Version'), '2025-03-26');
    if (input.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (input.method === 'tools/list') return Response.json({ jsonrpc: '2.0', id: input.id, result: { tools: [{ name: 'read_catalog', annotations: { readOnlyHint: true } }, { name: 'write_catalog', annotations: { readOnlyHint: false } }] } });
    assert.equal(input.method, 'tools/call'); assert.equal(input.params.name, 'read_catalog');
    return Response.json({ jsonrpc: '2.0', id: input.id, result: { content: [{ type: 'text', text: 'items' }] } });
  } });
  const capabilities = createCapabilities(c);
  const call = capabilities.find(t => t.name === 'mcp_tool_call')!;
  const result: any = await call.execute({ name: 'read_catalog', arguments: {} });
  assert.equal(result.content[0].text, 'items');
  await assert.rejects(call.execute({ name: 'write_catalog', arguments: {} }), /advertised read-only/);
  assert.equal(methods.filter(m => m === 'initialize').length, 1);
  assert.equal(methods.filter(m => m === 'tools/call').length, 1);
});
test('HTTP adapter enforces the limit on streaming bodies without content length', async () => {
  const c = context({ fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(600_000)); controller.enqueue(new Uint8Array(600_000)); controller.close(); } })) });
  await assert.rejects(request(c, 'https://api.github.com/user'), /exceeds 1 MiB/);
});
test('HTTP errors redact query credentials in configured RPC URLs', async () => {
  const c = context({ env: { SOLANA_RPC_URL: 'https://1.1.1.1/rpc?api-key=query-secret' }, fetch: async () => new Response('Failed query-secret at https://1.1.1.1/rpc?api-key=query-secret', { status: 403 }) });
  await assert.rejects(request(c, c.env.SOLANA_RPC_URL!, {}, true), error => error instanceof Error && !error.message.includes('query-secret'));
});
