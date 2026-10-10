import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { getConfig } from '../src/config.js';
import { Runtime } from '../src/runtime.js';
import { Store, type Task } from '../src/store.js';
import { Supervisor } from '../src/supervisor.js';

function fixture(t:TestContext) {
  const parent=realpathSync(tmpdir());const root=mkdtempSync(join(parent,'solo-preparation-'));
  const config={...getConfig(root),root,dataDir:join(root,'data'),workspace:join(root,'workspace'),modelProvider:'chatgpt',autoEve:false};
  const store=new Store(join(config.dataDir,'test.sqlite'));const runtime=new Runtime(config,{},store);
  for(const task of store.tasks())store.updateTask(task.id,{status:'cancelled'});
  const runs:string[]=[];
  function supervisor() {
    const instance=new Supervisor(runtime);
    (instance as any).client={fetch:async()=>new Response('{}',{status:200})};
    (instance as any).run=async(task:Task)=>{runs.push(task.title);store.updateTask(task.id,{status:'completed',result:'Mock completed bounded preparation; no model or provider called',leaseUntil:undefined});};
    return instance;
  }
  function due(){store.setSetting('scheduler.lastCycleMs',0);}
  t.after(()=>{store.close();assert.equal(dirname(root),parent);rmSync(root,{recursive:true,force:true});});
  return {root,store,runtime,runs,supervisor,due};
}

test('unchanged automatic preparation makes one bounded run and stays suppressed after restart',async t=>{
  const f=fixture(t);const first=f.supervisor();await first.tick();assert.equal(f.runs.length,1);
  f.due();await first.tick();f.due();await f.supervisor().tick();
  assert.equal(f.runs.length,1);assert.equal(f.store.events().filter(e=>e.type==='preparation.waiting').length,1);
  assert.equal(first.status().preparationWaiting,true);assert.equal(f.runtime.challenge().startedAt,null);
  f.store.put('memory',{content:'A model handoff is not a new owner/readiness event'},'agent-output');
  f.store.ledgerRecord({type:'funding',amountUsd:200,description:'Unverified model claim',externalRef:'claim:capital'});
  f.due();await first.tick();assert.equal(f.runs.length,1,'agent claims and generated memory cannot sustain periodic inference');
});

test('credential rotation, verified evidence and owner ideas wake one run without exposing secrets',async t=>{
  const f=fixture(t);const instance=f.supervisor();await instance.tick();
  f.runtime.env.GITHUB_TOKEN='private_test_token_one';await instance.tick();assert.equal(f.runs.length,2);
  f.due();await instance.tick();assert.equal(f.runs.length,2);
  f.runtime.env.GITHUB_TOKEN='private_test_token_two';await instance.tick();assert.equal(f.runs.length,3);
  f.store.ledgerRecord({type:'funding',amountUsd:200,description:'Owner verified fixture only',externalRef:'owner:capital'},true,'owner');
  await instance.tick();assert.equal(f.runs.length,4);
  mkdirSync(join(f.root,'docs'));writeFileSync(join(f.root,'docs','owner-ideas.md'),'New owner candidate; not action authorization');
  await instance.tick();assert.equal(f.runs.length,5);
  f.due();await f.supervisor().tick();assert.equal(f.runs.length,5);
  assert.match(f.store.setting('scheduler.preparationFingerprint',''),/^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(f.store.events()).includes('private_test_token'));
  assert.equal(f.runtime.challenge().startedAt,null);assert.equal(f.runtime.challenge().revenueUsd,0);
});

test('explicit tasks, due schedules, owner tick and started challenge keep dispatching',async t=>{
  const f=fixture(t);const instance=f.supervisor();await instance.tick();f.due();await instance.tick();
  f.store.enqueue({title:'Distinct requested work'});await instance.tick();assert.equal(f.runs.at(-1),'Distinct requested work');
  f.store.put('schedule',{task:{title:'Due support obligation'},intervalSeconds:3600,nextRunAt:new Date(0).toISOString()},'support');
  f.due();await instance.tick();assert.equal(f.runs.at(-1),'Due support obligation');
  const count=f.runs.length;await instance.tick(true);assert.equal(f.runs.length,count+1,'explicit owner tick can request a fresh cycle');
  f.runtime.startChallenge();f.due();await instance.tick();f.due();await instance.tick();
  assert.equal(f.runs.filter(title=>title==='Review evidence and advance the strongest earning experiment').length,2);
  assert.equal(instance.status().preparationWaiting,false);
});

test('installing suppression adopts completed legacy work without repeating it',async t=>{
  const f=fixture(t);const task=f.store.enqueue({title:'Advance preparation using existing capabilities',instructions:'Read challenge status, shared memory, experiment results and tool availability. Legacy automatic cycle.'});
  f.store.updateTask(task.id,{status:'completed',result:'Existing evidence saved'});
  const instance=f.supervisor();instance.start();await instance.stop();assert.equal(f.runs.length,0);
  assert.equal(instance.status().preparationWaiting,true,'upgrade enters readiness waiting immediately at startup');
  assert.equal(f.store.task(task.id)?.status,'completed');
  f.runtime.config.enablePublicActions=true;await f.supervisor().tick();assert.equal(f.runs.length,1);
});
