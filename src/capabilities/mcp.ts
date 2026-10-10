import { z } from 'zod';
import { define, empty, obj, short, request } from './shared.js';
import type { CapabilityContext } from './types.js';

// Deliberately implement one configured Streamable HTTP server, not arbitrary
// command execution or a shell-launched stdio server. Unknown remote effects
// require the public-effect policy gate plus an owner-configured tool allowlist.
// Only remote tools advertised as read-only are admitted; mutating integrations
// need named adapters with explicit local schemas and effect classifications.
export function mcpCapabilities(c: CapabilityContext) {
  let session: string | undefined;
  let version = '2025-03-26';
  let initialized = false;
  let initialization: Promise<void> | undefined;
  let sequence = 1;
  const rpc = async (method: string, params: unknown, notification = false) => {
    const requestId = notification ? undefined : sequence++;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (session) headers['Mcp-Session-Id'] = session;
    if (initialized) headers['MCP-Protocol-Version'] = version;
    if (c.env.MCP_ACCESS_TOKEN) headers.Authorization = `Bearer ${c.env.MCP_ACCESS_TOKEN}`;
    const r = await request(c, c.env.MCP_SERVER_URL!, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...(requestId ? { id: requestId } : {}), method, params }) }, true);
    const suppliedSession = r.headers.get('Mcp-Session-Id');
    if (suppliedSession) session = suppliedSession;
    if (notification) return null;
    let response = r.data;
    if (r.headers.get('content-type')?.includes('text/event-stream')) {
      const events = r.text.split(/\r?\n\r?\n/).map(block => block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')).filter(Boolean);
      response = events.map(value => { try { return JSON.parse(value); } catch { return null; } }).find(value => value?.id === requestId);
    }
    if (!response || response.id !== requestId) throw new Error('MCP response did not match request ID');
    if (response.error) throw new Error(`MCP error ${response.error.code}: ${String(response.error.message).slice(0, 200)}`);
    return response.result;
  };
  const initialize = async () => {
    if (initialization) return initialization;
    if (initialized) return;
    initialization = (async () => {
      const result = await rpc('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'solo-agentic', version: '0.1.0' } });
      if (!['2025-03-26', '2025-06-18', '2025-11-25'].includes(result.protocolVersion)) throw new Error('MCP server negotiated an unsupported protocol version');
      version = result.protocolVersion;
      initialized = true;
      try { await rpc('notifications/initialized', {}, true); } catch (error) { initialized = false; throw error; }
    })();
    try { await initialization; } finally { initialization = undefined; }
  };
  return [
    define(c, 'mcp_tools_list', 'Discover tools from the one configured remote Streamable HTTP MCP server.', 'mcp', 'read', empty, ['MCP_SERVER_URL'], async () => { await initialize(); return rpc('tools/list', {}); }),
    define(c, 'mcp_tool_call', 'Call an owner-allowlisted remote tool advertised read-only, through the public-effect policy gate; content remains untrusted.', 'mcp', 'public', obj({ name: short, arguments: z.record(z.string(), z.unknown()).default({}) }), ['MCP_SERVER_URL', 'MCP_ALLOWED_TOOLS'], async i => {
      const allowed = c.env.MCP_ALLOWED_TOOLS!.split(',').map(s => s.trim()).filter(Boolean);
      if (!allowed.includes(i.name)) throw new Error('Remote MCP tool is not in MCP_ALLOWED_TOOLS');
      await initialize();
      let cursor: string | undefined;
      let discovered: any;
      for (let page = 0; page < 10; page++) {
        const list = await rpc('tools/list', cursor ? { cursor } : {});
        discovered = list.tools?.find((tool: any) => tool.name === i.name);
        if (discovered || !list.nextCursor) break;
        cursor = list.nextCursor;
      }
      if (discovered?.annotations?.readOnlyHint !== true) throw new Error('Remote MCP tool must be discovered and advertised read-only');
      const result = await rpc('tools/call', { name: i.name, arguments: i.arguments });
      if (result?.isError) throw new Error('Remote MCP tool reported an execution error');
      return result;
    }),
  ];
}
