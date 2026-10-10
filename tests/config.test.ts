import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('private local configuration overrides defaults while inherited settings stay authoritative',async()=>{
  const root=await mkdtemp(join(tmpdir(),'solo-config-'));
  try {
    await writeFile(join(root,'.env'),'SOLO_TEST_PROVIDER=default\nSOLO_TEST_SCOPE=default\nSOLO_TEST_FALLBACK=default\n');
    await writeFile(join(root,'.env.local'),'SOLO_TEST_PROVIDER=private-local\nSOLO_TEST_SCOPE=private-local\n');
    const source=`import { loadEnvironment } from ${JSON.stringify(new URL('../src/config.ts',import.meta.url).href)};loadEnvironment(${JSON.stringify(root)});console.log(JSON.stringify([process.env.SOLO_TEST_PROVIDER,process.env.SOLO_TEST_SCOPE,process.env.SOLO_TEST_FALLBACK]));`;
    const env:NodeJS.ProcessEnv={...process.env,SOLO_TEST_SCOPE:'inherited'};delete env.SOLO_TEST_PROVIDER;delete env.SOLO_TEST_FALLBACK;
    const result=execFileSync(process.execPath,['--input-type=module','-e',source],{env,encoding:'utf8',windowsHide:true,timeout:10000});
    assert.deepEqual(JSON.parse(result),['private-local','inherited','default']);
  } finally {await rm(root,{recursive:true,force:true});}
});
