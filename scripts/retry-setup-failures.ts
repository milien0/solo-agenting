import { Client } from 'eve/client';
import { loadEnvironment,getConfig } from '../src/config.js';
import { Store } from '../src/store.js';
import { join } from 'node:path';
loadEnvironment();const config=getConfig();const store=new Store(join(config.dataDir,'solo.sqlite'));
const client=new Client({host:`http://127.0.0.1:${config.evePort}`});
let recovered=0;
for(const task of store.tasks('needs_attention',500)) {
  if(!task.sessionId||!task.error?.includes('MODEL_CALL_FAILED'))continue;
  const snapshot=await client.sessions.attach(task.sessionId).snapshot({signal:AbortSignal.timeout(10000)});
  if(snapshot.events.some(event=>event.type==='step.completed'||event.type.startsWith('action.')))continue;
  if(!snapshot.events.some(event=>(event.type==='session.failed'||event.type==='turn.failed')&&event.data.code==='MODEL_CALL_FAILED'))continue;
  store.updateTask(task.id,{status:'queued',sessionId:undefined,streamIndex:undefined,error:undefined,leaseUntil:undefined,nextAttemptAt:undefined});
  store.event('task.setup_retry',`Verified no completed model step or action before retry: ${task.title}`);
  recovered++;
}
console.log(`${recovered} setup-failed tasks safely requeued after inspecting durable sessions.`);
store.close();
