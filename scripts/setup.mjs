import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname,resolve } from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<24||(major===24&&minor<13))throw new Error('Solo Agentic requires Node.js 24.13 or newer');
if(!existsSync(resolve(root,'node_modules/tsx'))) {
  const install=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['ci','--include=dev'],{cwd:root,stdio:'inherit',shell:process.platform==='win32'});
  if(install.status!==0)process.exit(install.status||1);
}
const run=spawnSync(process.execPath,['--import','tsx',resolve(root,'scripts/setup-runtime.ts')],{cwd:root,stdio:'inherit'});
process.exit(run.status??1);
