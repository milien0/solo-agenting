import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { define, empty, short, text, obj } from './shared.js';
import type { CapabilityContext } from './types.js';

export async function workspacePath(workspace: string, input: string): Promise<string> {
  const segments = input.split(/[\\/]/);
  if (!input || path.isAbsolute(input) || /[:\x00]/.test(input) || segments.some(part => part.startsWith('.') || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Workspace path must be relative and cannot access hidden, parent or device paths');
  const root = await fs.realpath(workspace);
  const target = path.resolve(root, input);
  const within = (p: string) => p === root || (!path.relative(root, p).startsWith('..') && !path.isAbsolute(path.relative(root, p)));
  if (!within(target)) throw new Error('Path escapes the workspace');
  let current = target;
  while (true) {
    try {
      const real = await fs.realpath(current);
      if (!within(real)) throw new Error('Symlink path escapes the workspace');
      if (path.relative(root, real).split(path.sep).some(part => part.startsWith('.'))) throw new Error('Symlink path accesses hidden workspace content');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
  return target;
}
async function readFile(workspace: string, name: string) {
  const filename = await workspacePath(workspace, name);
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size > 1_048_576) throw new Error('Requires a regular file up to 1 MiB');
  return fs.readFile(filename, 'utf8');
}
export function parseCsv(csv: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], value = '', quoted = false, closed = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]!;
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') { value += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else value += ch;
    } else if (ch === '"' && value === '' && !closed) quoted = true;
    else if (ch === delimiter) { row.push(value); value = ''; closed = false; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      row.push(value); rows.push(row); row = []; value = ''; closed = false;
    } else {
      if (closed) throw new Error('Invalid CSV content after closing quote');
      value += ch;
    }
  }
  if (quoted) throw new Error('Unterminated CSV quote');
  if (value || row.length || closed) { row.push(value); rows.push(row); }
  return rows;
}
const numeric = z.number().finite();
const numbers = z.array(numeric).min(1).max(10_000);
export function localCapabilities(c: CapabilityContext) {
  const add = (name: string, description: string, category: string, effect: 'read' | 'write', schema: z.ZodType, fn: (i: any) => any) => define(c, name, description, category, effect, schema, [], fn);
  const fileSchema = obj({ path: short });
  return [
    add('workspace_list', 'List visible files in a workspace directory.', 'workspace', 'read', obj({ path: short.optional() }), async i => {
      const target = i.path ? await workspacePath(c.workspace, i.path) : await fs.realpath(c.workspace);
      const entries = await fs.readdir(target, { withFileTypes: true });
      return entries.filter(e => !e.name.startsWith('.')).slice(0, 500).map(e => ({ name: e.name, directory: e.isDirectory(), symlink: e.isSymbolicLink() }));
    }),
    add('workspace_read', 'Read a visible UTF-8 file up to 1 MiB.', 'workspace', 'read', fileSchema, i => readFile(c.workspace, i.path)),
    add('workspace_stat', 'Inspect size and modification time of a visible path.', 'workspace', 'read', fileSchema, async i => { const s = await fs.stat(await workspacePath(c.workspace, i.path)); return { bytes: s.size, directory: s.isDirectory(), modifiedAt: s.mtime.toISOString() }; }),
    add('workspace_write', 'Write UTF-8 content; existing files require overwrite=true.', 'workspace', 'write', obj({ path: short, content: text, overwrite: z.boolean().default(false) }), async i => { const p = await workspacePath(c.workspace, i.path); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, i.content, { flag: i.overwrite ? 'w' : 'wx' }); return { path: i.path, bytes: Buffer.byteLength(i.content) }; }),
    add('workspace_append', 'Append UTF-8 content to a visible file up to 1 MiB total.', 'workspace', 'write', obj({ path: short, content: text }), async i => { const p = await workspacePath(c.workspace, i.path); let size = 0; try { size = (await fs.stat(p)).size; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } if (size + Buffer.byteLength(i.content) > 1_048_576) throw new Error('File exceeds 1 MiB'); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.appendFile(p, i.content); return { path: i.path }; }),
    add('workspace_mkdir', 'Create a visible workspace directory.', 'workspace', 'write', fileSchema, async i => { await fs.mkdir(await workspacePath(c.workspace, i.path), { recursive: true }); return { path: i.path }; }),
    add('workspace_copy', 'Copy a visible regular file; never overwrite an existing target.', 'workspace', 'write', obj({ source: short, destination: short }), async i => { const content = await readFile(c.workspace, i.source); const p = await workspacePath(c.workspace, i.destination); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, content, { flag: 'wx' }); return { path: i.destination }; }),
    add('workspace_search', 'Find literal text in one visible UTF-8 file.', 'workspace', 'read', obj({ path: short, query: short, caseSensitive: z.boolean().default(false) }), async i => { const content = await readFile(c.workspace, i.path); const q = i.caseSensitive ? i.query : i.query.toLowerCase(); return content.split(/\r?\n/).map((line, index) => ({ line: index + 1, text: line })).filter(row => (i.caseSensitive ? row.text : row.text.toLowerCase()).includes(q)).slice(0, 100); }),
    add('workspace_hash', 'Compute SHA-256 for a visible UTF-8 file.', 'workspace', 'read', fileSchema, async i => ({ sha256: createHash('sha256').update(await readFile(c.workspace, i.path)).digest('hex') })),
    add('workspace_json_read', 'Parse a visible JSON file.', 'workspace', 'read', fileSchema, async i => JSON.parse(await readFile(c.workspace, i.path))),
    add('workspace_csv_read', 'Read and parse a visible CSV file.', 'workspace', 'read', obj({ path: short, delimiter: z.string().length(1).default(',') }), async i => parseCsv(await readFile(c.workspace, i.path), i.delimiter)),
    add('text_stats', 'Count characters, words, lines and estimated reading seconds.', 'text', 'read', obj({ text }), i => { const words = i.text.trim() ? i.text.trim().split(/\s+/).length : 0; return { characters: [...i.text].length, bytes: Buffer.byteLength(i.text), words, lines: i.text ? i.text.split('\n').length : 0, readingSeconds: Math.ceil(words / 200 * 60) }; }),
    add('text_slug', 'Convert text to a lowercase URL slug.', 'text', 'read', obj({ text }), i => i.text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')),
    add('text_replace', 'Replace a literal string without evaluating expressions.', 'text', 'read', obj({ text, find: short, replacement: text }), i => i.text.split(i.find).join(i.replacement)),
    add('text_split', 'Split text into lines, words or fixed-size chunks.', 'text', 'read', obj({ text, mode: z.enum(['lines', 'words', 'chunks']), chunkSize: z.number().int().min(1).max(10_000).default(1000) }), i => i.mode === 'lines' ? i.text.split(/\r?\n/) : i.mode === 'words' ? i.text.trim().split(/\s+/).filter(Boolean) : Array.from({ length: Math.ceil(i.text.length / i.chunkSize) }, (_, n) => i.text.slice(n * i.chunkSize, (n + 1) * i.chunkSize))),
    add('text_template', 'Fill {{name}} placeholders from explicit string values.', 'text', 'read', obj({ template: text, values: z.record(z.string(), z.string().max(10_000)) }), i => i.template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match: string, key: string) => i.values[key] ?? match)),
    add('text_diff', 'Compare two texts and return changed lines by index.', 'text', 'read', obj({ before: text, after: text }), i => { const a = i.before.split('\n'), b = i.after.split('\n'); return Array.from({ length: Math.max(a.length, b.length) }, (_, n) => ({ line: n + 1, before: a[n] ?? null, after: b[n] ?? null })).filter(x => x.before !== x.after).slice(0, 1000); }),
    add('json_parse', 'Parse and validate JSON syntax.', 'data', 'read', obj({ text }), i => JSON.parse(i.text)),
    add('json_format', 'Format a JSON value with indentation.', 'data', 'read', obj({ value: z.unknown() }), i => JSON.stringify(i.value, null, 2)),
    add('csv_parse', 'Parse quoted CSV including escaped quotes and embedded newlines.', 'data', 'read', obj({ text, delimiter: z.string().length(1).default(',') }), i => parseCsv(i.text, i.delimiter)),
    add('csv_stringify', 'Serialize string rows as quoted CSV.', 'data', 'read', obj({ rows: z.array(z.array(z.string().max(10_000))).max(10_000), delimiter: z.string().length(1).default(',') }), i => i.rows.map((r: string[]) => r.map(v => '"' + v.replace(/"/g, '""') + '"').join(i.delimiter)).join('\r\n')),
    add('data_unique', 'Remove duplicates from scalar values.', 'data', 'read', obj({ values: z.array(z.union([z.string(), numeric, z.boolean(), z.null()])).max(10_000) }), i => [...new Set(i.values)]),
    add('data_sort', 'Sort finite numeric values ascending or descending.', 'data', 'read', obj({ values: numbers, descending: z.boolean().default(false) }), i => [...i.values].sort((a, b) => i.descending ? b - a : a - b)),
    add('calculate', 'Apply arithmetic to finite numeric operands; no code evaluation.', 'math', 'read', obj({ operation: z.enum(['sum', 'subtract', 'multiply', 'divide', 'min', 'max']), values: numbers }), i => { let result: number; if (i.operation === 'divide' && i.values.slice(1).includes(0)) throw new Error('Division by zero'); switch (i.operation) { case 'sum': result = i.values.reduce((a: number, b: number) => a + b, 0); break; case 'subtract': result = i.values.reduce((a: number, b: number) => a - b); break; case 'multiply': result = i.values.reduce((a: number, b: number) => a * b, 1); break; case 'divide': result = i.values.reduce((a: number, b: number) => a / b); break; case 'min': result = Math.min(...i.values); break; default: result = Math.max(...i.values); } if (!Number.isFinite(result)) throw new Error('Result is not finite'); return { result }; }),
    add('statistics', 'Compute mean, median, sum and population standard deviation.', 'math', 'read', obj({ values: numbers }), i => { const v = [...i.values].sort((a, b) => a - b), sum = v.reduce((a, b) => a + b, 0), mean = sum / v.length, m = Math.floor(v.length / 2); return { count: v.length, sum, mean, median: v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2, standardDeviation: Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) }; }),
    add('percentage', 'Compute a part as a percentage of a nonzero total.', 'math', 'read', obj({ part: numeric, total: numeric.refine(n => n !== 0) }), i => ({ percent: i.part / i.total * 100 })),
    add('unit_economics', 'Calculate contribution margin and break-even sales from explicit costs.', 'math', 'read', obj({ price: numeric.nonnegative(), variableCost: numeric.nonnegative(), fixedCost: numeric.nonnegative() }), i => { const margin = i.price - i.variableCost; return { contributionMargin: margin, marginPercent: i.price ? margin / i.price * 100 : null, breakEvenUnits: margin > 0 ? Math.ceil(i.fixedCost / margin) : null }; }),
    add('goal_forecast', 'Project required daily revenue using current verified revenue and days remaining.', 'math', 'read', obj({ targetUsd: numeric.positive(), verifiedRevenueUsd: numeric.nonnegative(), daysRemaining: numeric.positive() }), i => ({ remainingUsd: Math.max(0, i.targetUsd - i.verifiedRevenueUsd), requiredDailyUsd: Math.max(0, i.targetUsd - i.verifiedRevenueUsd) / i.daysRemaining })),
    add('time_now', 'Return current UTC time and epoch milliseconds.', 'time', 'read', empty, () => { const d = new Date(); return { utc: d.toISOString(), epochMs: d.getTime() }; }),
    add('time_convert', 'Format an ISO timestamp in a specified IANA timezone.', 'time', 'read', obj({ timestamp: z.string().datetime({ offset: true }), timezone: short }), i => new Intl.DateTimeFormat('en-GB', { timeZone: i.timezone, dateStyle: 'full', timeStyle: 'long' }).format(new Date(i.timestamp))),
    add('time_add', 'Add seconds to an ISO timestamp.', 'time', 'read', obj({ timestamp: z.string().datetime({ offset: true }), seconds: numeric.min(-31_536_000).max(31_536_000) }), i => new Date(new Date(i.timestamp).getTime() + i.seconds * 1000).toISOString()),
    add('time_difference', 'Calculate elapsed seconds between two ISO timestamps.', 'time', 'read', obj({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }), i => ({ seconds: (new Date(i.to).getTime() - new Date(i.from).getTime()) / 1000 })),
    add('generate_uuid', 'Create a random UUID for idempotency and record identifiers.', 'data', 'read', empty, () => ({ uuid: randomUUID() })),
    add('hash_text', 'Compute SHA-256 of text.', 'data', 'read', obj({ text }), i => ({ sha256: createHash('sha256').update(i.text).digest('hex') })),
    add('base64_encode', 'Encode UTF-8 text as base64.', 'data', 'read', obj({ text }), i => Buffer.from(i.text).toString('base64')),
    add('base64_decode', 'Decode base64 text as UTF-8.', 'data', 'read', obj({ value: z.string().max(350_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }), i => Buffer.from(i.value, 'base64').toString('utf8')),
  ];
}
