import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Client, type MessageStreamEvent } from 'eve/client';
import { Runtime, roles } from './runtime.js';
import type { Task } from './store.js';

export function classifyEvents(events:readonly MessageStreamEvent[]) {
  const last=events.findLast(e=>['turn.failed','session.failed','turn.cancelled','turn.completed','session.completed','turn.started','turn.waiting'].includes(e.type));
  if(last&&['turn.failed','session.failed','turn.cancelled'].includes(last.type))return {status:'needs_attention',error:JSON.stringify(last.data).slice(0,3000)};
  if(last?.type==='turn.waiting'&&last.data.on==='input')return {status:'needs_attention',error:'Agent is waiting for owner input or authorization'};
  if(last?.type==='turn.started'||last?.type==='turn.waiting')return {status:'recovering',error:'Current durable turn is still running; awaiting its existing session'};
  if(last)return {status:'completed',result:events.filter(e=>e.type==='message.completed').map(e=>(e.data as {message:string}).message).join('\n').slice(-24000)};
  return {status:'recovering',error:'Durable turn is still running; awaiting its existing session'};
}

export class Supervisor {
  readonly client:Client;
  readonly startedAt=Date.now();
  active=new Map<string,AbortController>();
  engine?:ChildProcess;
  modelReady=false;
  engineReady=false;
  private modelState:'unverified'|'ready'|'failed'='unverified';
  private modelStateKey:string;
  lastTickAt:string|null=null;
  nextTickAt:string|null=null;
  private timer?:NodeJS.Timeout;
  private engineRetry?:NodeJS.Timeout;
  private stopping=false;
  private ticking=false;
  private failures=0;
  constructor(readonly runtime:Runtime) {
    this.client=new Client({host:`http://127.0.0.1:${runtime.config.evePort}`});
    this.modelStateKey=`model.state:${runtime.config.modelProvider}:${runtime.env.EVE_MODEL||'default'}`;
    this.modelState=runtime.store.setting(this.modelStateKey,'unverified');
  }
  credentialsConfigured() {
    return this.runtime.config.modelProvider==='chatgpt'||Boolean(this.runtime.env.AI_GATEWAY_API_KEY||this.runtime.env.VERCEL_OIDC_TOKEN);
  }
  private preparationFingerprint() {
    const names=[...new Set(this.runtime.capabilities.flatMap(tool=>tool.requiredEnv).concat(['EVE_MODEL','AI_GATEWAY_API_KEY','VERCEL_OIDC_TOKEN','SOLANA_WALLET_ADDRESS']))].sort();
    let ownerIdeas='absent';
    try {ownerIdeas=readFileSync(join(this.runtime.config.root,'docs','owner-ideas.md'),'utf8');}
    catch(error) {if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}
    // Persist only the digest; neither credential values nor owner content enter events.
    return createHash('sha256').update(JSON.stringify({
      credentials:names.map(name=>[name,this.runtime.env[name]||'']),
      policy:{provider:this.runtime.config.modelProvider,public:this.runtime.config.enablePublicActions,financial:this.runtime.config.enableFinancialActions,modelAllowance:this.runtime.config.maxTotalModelCostUsd,sessionAllowance:this.runtime.config.maxSessionCostUsd,capital:this.runtime.config.initialCapitalUsd},
      ledger:this.runtime.store.ledger().filter(entry=>entry.verified),ownerIdeas,
    })).digest('hex');
  }
  private allowPreparation(fingerprint:string,force:boolean) {
    const store=this.runtime.store;const key='scheduler.preparationFingerprint';
    let previous=store.setting<string|null>(key,null);
    if(previous===null&&!force&&this.hasCompletedPreparation()) {
      // Adopt a completed legacy cycle when installing suppression on an existing host.
      store.setSetting(key,fingerprint);previous=fingerprint;
    }
    if(!force&&previous===fingerprint) {
      if(!store.setting('scheduler.preparationWaiting',false))store.event('preparation.waiting','Automatic preparation is waiting for changed credentials, action scopes, owner ideas or verified funding/evidence. Explicit tasks and schedules remain active.');
      store.setSetting('scheduler.preparationWaiting',true);return false;
    }
    store.setSetting(key,fingerprint);store.setSetting('scheduler.preparationWaiting',false);return true;
  }
  private hasCompletedPreparation() {
    return this.runtime.store.tasks(undefined,500).some(task=>task.status==='completed'&&task.title==='Advance preparation using existing capabilities'&&task.instructions.startsWith('Read challenge status, shared memory, experiment results and tool availability.'));
  }
  startEngine() {
    if(this.stopping||this.engine||!this.runtime.config.autoEve||!this.credentialsConfigured())return;
    const {config}=this.runtime;
    const logfile=createWriteStream(join(config.dataDir,'eve-engine.log'),{flags:'a'});
    this.engine=spawn(process.execPath,[join(config.root,'node_modules/eve/bin/eve.js'),'dev','--host','127.0.0.1','--port',String(config.evePort),'--no-ui','--resume','--no-default-extensions'],{cwd:config.root,env:{...process.env,...this.runtime.env,SOLO_API_TOKEN:config.internalToken,SOLO_RUNTIME_URL:`http://127.0.0.1:${config.port}`},windowsHide:true,stdio:['ignore','pipe','pipe']});
    this.engine.stdout?.pipe(logfile,{end:false});this.engine.stderr?.pipe(logfile,{end:false});
    this.engine.on('error',()=>{this.runtime.store.event('engine.error','Agent engine could not start; inspect data/eve-engine.log');});
    this.engine.on('exit',(code)=>{
      logfile.end();this.engine=undefined;this.modelReady=false;
      if(!this.stopping){this.runtime.store.event('engine.stopped',`Agent engine stopped (${code}); restarting with backoff`);this.engineRetry=setTimeout(()=>this.startEngine(),Math.min(60000,5000*2**Math.min(this.failures++,4)));}
    });
    this.runtime.store.event('engine.starting',`Starting persistent eve engine (${config.modelProvider})`);
  }
  start() {
    if(this.runtime.challenge().status==='setup'&&this.runtime.store.setting('scheduler.preparationFingerprint',null)===null&&this.hasCompletedPreparation())this.allowPreparation(this.preparationFingerprint(),false);
    for(const task of this.runtime.store.tasks('running',500)) {
      this.runtime.store.updateTask(task.id,{status:task.sessionId?'recovering':'queued',error:'Supervisor restarted; inspecting the existing durable session',leaseUntil:undefined});
    }
    this.runtime.store.recoverExpired();
    this.startEngine();
    this.timer=setInterval(()=>void this.tick().catch(()=>this.runtime.store.event('runtime.error','Scheduler cycle failed')),15000);
    void this.tick();
  }
  async tick(force=false) {
    if(this.ticking||this.stopping)return;
    this.ticking=true;
    try {
      const now=Date.now();
      try {
        const health=await this.client.fetch('/eve/v1/health',{signal:AbortSignal.timeout(5000)});
        if(!health.ok)throw new Error('Agent engine health check failed');
        this.engineReady=true;this.failures=0;
      } catch {this.engineReady=false;}
      this.modelReady=this.engineReady&&this.modelState==='ready';
      const canDispatch=this.engineReady&&this.credentialsConfigured()&&this.modelState!=='failed';
      this.runtime.store.recoverExpired(now);
      if(this.runtime.store.setting('paused',false))return;
      if(this.engineReady)await this.recover();
      const previous=this.runtime.store.setting<number>('scheduler.lastCycleMs',0);
      const setup=this.runtime.challenge().status==='setup';
      const fingerprint=setup?this.preparationFingerprint():null;
      const previousFingerprint=this.runtime.store.setting<string|null>('scheduler.preparationFingerprint',null);
      const readinessChanged=setup&&previousFingerprint!==null&&previousFingerprint!==fingerprint;
      const cycleDue=force||readinessChanged||now-previous>=this.runtime.config.tickSeconds*1000;
      this.nextTickAt=new Date(previous+this.runtime.config.tickSeconds*1000).toISOString();
      if(cycleDue) {
        this.lastTickAt=new Date(now).toISOString();
        this.runtime.store.setSetting('scheduler.lastCycleMs',now);
        this.nextTickAt=new Date(now+this.runtime.config.tickSeconds*1000).toISOString();
        for(const schedule of this.runtime.store.list('schedule')) {
          if(Date.parse(schedule.nextRunAt)<=now) {
            this.runtime.store.enqueue(schedule.task);
            this.runtime.store.put('schedule',{nextRunAt:new Date(now+schedule.intervalSeconds*1000).toISOString()},schedule.id);
          }
        }
        const challenge=this.runtime.challenge();
        if(canDispatch&&['setup','running'].includes(challenge.status)&&!this.runtime.store.tasks('queued').length&&!this.active.size&&!this.runtime.store.tasks('recovering').length&&(challenge.status!=='setup'||this.allowPreparation(fingerprint!,force))) {
          this.runtime.store.enqueue({title:challenge.status==='setup'?'Advance preparation using existing capabilities':'Review evidence and advance the strongest earning experiment',role:'orchestrator',instructions:`Read challenge status, shared memory, experiment results and tool availability. ${challenge.status==='setup'?'The official 30-day clock has not started and accounts/funds may be missing. Continue useful preparation, research and artifact creation.':'Choose the highest-value next lawful action based on current evidence, not a predetermined strategy.'} Delegate bounded independent jobs through swarm_delegate when useful (persistent queue enforces concurrency). Avoid repeatedly creating equivalent tasks. Produce artifacts or new evidence; if blocked, save the exact dependency and move to other useful work. Record an evidence-based handoff.`});
        }
      }
      if(canDispatch&&['setup','running'].includes(this.runtime.challenge().status)) {
        while(this.active.size+this.runtime.store.tasks('recovering',500).length<this.runtime.config.maxWorkers) {
          if(this.runtime.config.modelProvider!=='chatgpt'&&this.runtime.store.modelCosts().totalUsd+(this.active.size+this.runtime.store.tasks('recovering',500).length+1)*this.runtime.config.maxSessionCostUsd>Math.min(this.runtime.config.maxTotalModelCostUsd,this.runtime.config.initialCapitalUsd)) {
            if(!this.runtime.store.setting('model.budgetBlocked',false))this.runtime.store.event('model.budget_limit','Model cost plus reserved sessions reached the configured total allowance; no new paid sessions dispatched.');
            this.runtime.store.setSetting('model.budgetBlocked',true);break;
          }
          this.runtime.store.setSetting('model.budgetBlocked',false);
          const task=this.runtime.store.claim(this.runtime.config.taskTimeoutMs+60000);
          if(!task)break;
          void this.run(task);
        }
      }
    } finally {this.ticking=false;}
  }
  private async run(task:Task) {
    const abort=new AbortController();this.active.set(task.id,abort);
    const timer=setTimeout(()=>abort.abort(),this.runtime.config.taskTimeoutMs);
    let sessionId=task.sessionId;
    try {
      const created=await this.client.sessions.create({signal:abort.signal});
      const session=created.session;
      sessionId=session.state.sessionId;
      this.runtime.store.updateTask(task.id,{sessionId,streamIndex:0});
      const prompt=`You are acting as the ${task.role} specialist in Solo Agentic.\nTask: ${task.title}\n${task.instructions}\n\nChallenge state: ${JSON.stringify(this.runtime.challenge())}\nUse discover/execute to inspect available tools and shared memory. Complete this bounded task, save artifacts and evidence, then return a concrete handoff. No invented receipts, balances, sales or actions. Task ID ${task.id}.`;
      const response=await session.send(prompt,{signal:abort.signal});
      const result=await response.result();
      if(result.events.some(e=>(e.type==='turn.failed'||e.type==='session.failed')&&String(e.data.code).includes('MODEL'))) {
        this.modelState='failed';this.modelReady=false;this.runtime.store.setSetting(this.modelStateKey,'failed');
        this.runtime.store.event('model.unavailable','Model inference failed. Correct model/auth configuration, then restart; no repeated failed earning cycles will be dispatched.');
      } else if(result.events.some(e=>e.type==='step.completed')) {
        this.modelState='ready';this.modelReady=true;this.runtime.store.setSetting(this.modelStateKey,'ready');
      }
      const outcome=classifyEvents(result.events);
      this.runtime.store.updateTask(task.id,{...outcome,streamIndex:session.state.streamIndex,leaseUntil:undefined});
      this.recordCost(sessionId,result.events);
      this.runtime.store.event(`task.${outcome.status}`,`${task.role}: ${task.title}`);
    } catch(error) {
      const message=error instanceof Error?error.message:'Agent task failed';
      if(sessionId) {
        try {if(abort.signal.aborted)await this.client.sessions.attach(sessionId).cancel({signal:AbortSignal.timeout(10000)});} catch {}
        this.runtime.store.updateTask(task.id,{status:'recovering',error:message.slice(0,1000),leaseUntil:undefined});
      } else {
        this.runtime.store.updateTask(task.id,{status:task.attempts>=3?'needs_attention':'queued',error:message.slice(0,1000),nextAttemptAt:new Date(Date.now()+Math.min(3600000,60000*2**task.attempts)).toISOString(),leaseUntil:undefined});
      }
      this.runtime.store.event('task.interrupted',`${task.title}: inspecting durable state before any retry`);
    } finally {clearTimeout(timer);this.active.delete(task.id);}
  }
  private recordCost(sessionId:string,events:readonly MessageStreamEvent[]) {
    const usage=events.findLast(e=>['session.waiting','session.completed','session.failed','turn.waiting'].includes(e.type))?.data as {usage?:{costUsd?:number}}|undefined;
    if(typeof usage?.usage?.costUsd==='number') this.runtime.store.put('model_cost',{amountUsd:usage.usage.costUsd},sessionId);
  }
  private async recover() {
    for(const task of this.runtime.store.tasks('recovering',20)) {
      if(!task.sessionId)continue;
      try {
        const session=this.client.sessions.attach(task.sessionId);
        const snapshot=await session.snapshot({signal:AbortSignal.timeout(10000)});
        const outcome=classifyEvents(snapshot.events);
        this.runtime.store.updateTask(task.id,{...outcome,streamIndex:snapshot.session.streamIndex});
        this.recordCost(task.sessionId,snapshot.events);
        if(outcome.status!=='recovering')this.runtime.store.event(`task.${outcome.status}`,`Recovered: ${task.title}`);
      } catch {
        this.runtime.store.updateTask(task.id,{status:'needs_attention',error:'Stored session unavailable. Inspect engine diagnostics before retrying external work.'});
      }
    }
  }
  status() {
    const config=this.runtime.config;
    const paused=this.runtime.store.setting('paused',false);
    const costs=this.runtime.store.modelCosts();
    const budgetBlocked=this.runtime.store.setting('model.budgetBlocked',false);
    return {mode:paused?'paused':budgetBlocked?'model_budget_limit':this.modelReady?'active':this.modelState==='failed'?'model_error':this.engineReady?'verifying_model':this.credentialsConfigured()?'starting_engine':'waiting_for_model',paused,modelReady:this.modelReady,preparationWaiting:this.runtime.challenge().status==='setup'&&this.runtime.store.setting('scheduler.preparationWaiting',false),lastTickAt:this.lastTickAt,nextTickAt:this.nextTickAt,activeWorkers:this.active.size,maxWorkers:config.maxWorkers,uptimeSeconds:Math.floor((Date.now()-this.startedAt)/1000),modelProvider:config.modelProvider,modelCostUsd:costs.reported?costs.totalUsd:null,modelCostReporting:costs.reported?'provider_reported':config.modelProvider==='chatgpt'?'subscription_usage_not_priced':'unavailable',maxTotalModelCostUsd:config.maxTotalModelCostUsd};
  }
  agents() {return roles.map(role=>({...role,status:this.runtime.store.tasks('running').some(t=>t.role===role.id)?'working':this.modelReady?'ready':'waiting'}));}
  async pause() {
    this.runtime.store.setSetting('paused',true);
    this.runtime.store.event('runtime.paused','Task dispatch and mutating tools paused; requesting cancellation of active sessions');
    for(const [id,abort] of this.active) {
      abort.abort();
      const task=this.runtime.store.task(id);
      if(task?.sessionId)try {await this.client.sessions.attach(task.sessionId).cancel({signal:AbortSignal.timeout(10000)});}catch{}
    }
  }
  async stop() {
    this.stopping=true;if(this.timer)clearInterval(this.timer);if(this.engineRetry)clearTimeout(this.engineRetry);
    for(const abort of this.active.values())abort.abort();
    if(this.engine){this.engine.kill();await new Promise<void>(resolve=>{this.engine!.once('exit',()=>resolve());setTimeout(resolve,5000);});}
  }
}
