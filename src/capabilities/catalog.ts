import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createCapabilities } from './index.js';

/** Update the documented catalog without calling any capability or provider. */
export function renderCapabilityCatalog(): string {
  const capabilities = createCapabilities({ workspace: process.cwd(), env: {}, runtime: async () => ({}), fetch });
  return [
    '| Tool | Category | Effect | Required configuration | Purpose |',
    '| --- | --- | --- | --- | --- |',
    ...capabilities.map(tool => `| ${tool.name} | ${tool.category} | ${tool.effect} | ${tool.requiredEnv.join(', ') || 'None'} | ${tool.description.replaceAll('|', '/')} |`),
  ].join('\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const filename = fileURLToPath(new URL('../../docs/tool-library.md', import.meta.url));
  const current = await readFile(filename, 'utf8');
  const marker = '<!-- Generated from createCapabilities; schema discovery is available through the runtime tool list. -->';
  if (!current.includes(marker)) throw new Error('Tool catalog marker missing');
  await writeFile(filename, current.slice(0, current.indexOf(marker) + marker.length) + '\n\n' + renderCapabilityCatalog() + '\n');
}
