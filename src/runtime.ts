import { mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { Config } from './config.js';
import { Store } from './store.js';
import { createCapabilities } from './capabilities/index.js';

export const roles = [
  {id:'orchestrator',name:'Solo',role:'Orchestrator'},
  {id:'researcher',name:'Scout',role:'Researcher'},
  {id:'builder',name:'Forge',role:'Builder'},
  {id:'operator',name:'Relay',role:'Operator'},
  {id:'finance',name:'Ledger',role:'Finance'},
];
export const connectorDefinitions = [
  {name:'GitHub',requiredEnv:['GITHUB_TOKEN'],docsUrl:'https://github.com/settings/tokens'},
  {name:'Search',requiredEnv:['BRAVE_SEARCH_API_KEY'],docsUrl:'https://api-dashboard.search.brave.com/'},
  {name:'Solana',requiredEnv:['SOLANA_RPC_URL','SOLANA_WALLET_ADDRESS'],docsUrl:'https://solana.com/docs/rpc'},
  {name:'Stripe',requiredEnv:['STRIPE_SECRET_KEY'],docsUrl:'https://dashboard.stripe.com/apikeys'},
  {name:'Gmail',requiredEnv:['GMAIL_ACCESS_TOKEN'],docsUrl:'https://developers.google.com/workspace/gmail/api/guides'},
  {name:'X',requiredEnv:['X_BEARER_TOKEN'],docsUrl:'https://docs.x.com/'},
  {name:'Vercel',requiredEnv:['VERCEL_TOKEN'],docsUrl:'https://vercel.com/account/settings/tokens'},
  {name:'Render',requiredEnv:['RENDER_API_KEY'],docsUrl:'https://dashboard.render.com/account/api-keys'},
  {name:'MCP',requiredEnv:['MCP_SERVER_URL','MCP_ALLOWED_TOOLS'],docsUrl:'https://modelcontextprotocol.io/docs/learn/server-concepts'},
];

export class Runtime {
  readonly store: Store;
  readonly capabilities: ReturnType<typeof createCapabilities>;
  constructor(readonly config: Config, readonly env: Record<string,string|undefined> = process.env, store?:Store) {
    mkdirSync(config.workspace,{recursive:true});
    this.store=store||new Store(join(config.dataDir,'solo.sqlite'));
    this.capabilities=createCapabilities({workspace:config.workspace,env,fetch:globalThis.fetch,runtime:(operation,input)=>this.operation(operation,input)});
    if(!this.store.setting('initialized',false)) {
      this.store.setSetting('initialized',true);
      this.store.setSetting('paused',false);
      this.store.event('system.ready','Solo Agentic initialized. Funding and revenue require evidence; challenge clock has not started.');
      this.store.enqueue({title:'Discover and compare lawful earning opportunities',role:'researcher',instructions:'Explore at least three realistic earning opportunities using the available tools. No strategy has been preselected. Research actual demand and distribution channels, estimate cash costs and time to first customer, and identify what can be built with currently connected accounts. Save sources and an opportunity memo in workspace; save evidence and proposed experiments in shared memory. Do not claim sales or publish/contact anyone unless the relevant channel is configured.'});
      this.store.enqueue({title:'Inventory capabilities and prepare the operating workspace',role:'builder',instructions:'Discover the available tool catalog and connection status. Create a useful workspace structure, a reusable delivery checklist and reusable digital-service/product templates for opportunities supported by evidence. Identify missing capabilities rather than assume accounts are connected. Save artifacts and a handoff in shared memory.'});
      this.store.enqueue({title:'Establish challenge bookkeeping and funding requirements',role:'finance',instructions:'The planned starting capital is $200 ($100 SOL, $100 card). Success is $1000 verified gross revenue within 30 days after the challenge is explicitly started. Inspect the challenge and connected finance tools, establish an evidence checklist and reconciliation procedure. Do not add fictional funding or revenue. Save required wallet public-address and Stripe setup requirements in shared memory.'});
    }
  }
  challenge() {
    const startedAt=this.store.setting<string|null>('challenge.startedAt',null);
    const endsAt=startedAt ? new Date(Date.parse(startedAt)+this.config.durationDays*86400000).toISOString():null;
    const totals=this.store.totals();
    const receipts=startedAt?this.store.revenueTotals(startedAt,endsAt):{grossReceiptsUsd:0,refundUsd:0,disputedReceiptsUsd:0,receiptAdjustmentsUsd:0,revenueUsd:0};
    const status=!startedAt?'setup':receipts.revenueUsd>=this.config.targetUsd?'succeeded':Date.now()>=Date.parse(endsAt!)?'expired':'running';
    return {name:'Solo Agentic',metric:'gross_revenue',metricDefinition:'Verified customer receipts before operating costs, adjusted for refunds and disputed receipts; raw gross receipts are reported separately.',initialCapitalUsd:this.config.initialCapitalUsd,targetUsd:this.config.targetUsd,durationDays:this.config.durationDays,status,startedAt,endsAt,...totals,...receipts,totalRevenueUsd:totals.revenueUsd,totalGrossReceiptsUsd:totals.grossReceiptsUsd,remainingDays:endsAt?Math.max(0,Math.ceil((Date.parse(endsAt)-Date.now())/86400000)):this.config.durationDays};
  }
  startChallenge() {
    if(!this.store.setting('challenge.startedAt',null)) {
      this.store.setSetting('challenge.startedAt',new Date().toISOString());
      this.store.event('challenge.started',`30-day challenge started: $${this.config.targetUsd} verified gross revenue, planned capital $${this.config.initialCapitalUsd}.`);
    }
    return this.challenge();
  }
  tools() {
    return this.capabilities.map(tool=>{
      const missingEnv=tool.requiredEnv.filter(name=>name.endsWith('_ENABLED')?this.env[name]!=='true':!this.env[name]);
      if(tool.effect==='public'&&!this.config.enablePublicActions) missingEnv.push('ENABLE_PUBLIC_ACTIONS=true');
      if(tool.effect==='financial'&&!tool.name.startsWith('ledger_')&&!this.config.enableFinancialActions) missingEnv.push('ENABLE_FINANCIAL_ACTIONS=true');
      let inputSchema:unknown;
      try {inputSchema=z.toJSONSchema(tool.inputSchema as any);} catch { inputSchema={description:'See tool library documentation for input schema'}; }
      return {name:tool.name,description:tool.description,category:tool.category,effect:tool.effect,available:missingEnv.length===0,missingEnv,inputSchema};
    });
  }
  async execute(name:string,input:unknown,idempotencyKey?:string) {
    const tool=this.capabilities.find(t=>t.name===name); if(!tool) throw new Error('Unknown capability');
    const parsed=tool.inputSchema.parse(input);
    const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
    const fingerprint=createHash('sha256').update(JSON.stringify(canonical(parsed))).digest('hex');
    if(idempotencyKey) {
      const previous=this.store.toolCall(`${name}:${idempotencyKey}`);
      if(previous) {
        if(previous.fingerprint!==fingerprint)throw new Error('Idempotency key conflicts with an existing operation payload');
        if(previous.status==='completed')return JSON.parse(previous.result!);
        throw new Error('This operation has an uncertain or failed outcome; inspect the provider before retrying');
      }
    }
    const status=this.tools().find(t=>t.name===name)!;
    if(!status.available) throw new Error(`Configure ${status.missingEnv.join(', ')} before using ${name}`);
    if(this.store.setting('paused',false)&&tool.effect!=='read') throw new Error('Runtime is paused');
    const external=tool.effect==='public'||(tool.effect==='financial'&&!name.startsWith('ledger_'));
    if(external&&!idempotencyKey) throw new Error('External mutations require a stable idempotencyKey');
    if(idempotencyKey) {
      const key=`${name}:${idempotencyKey}`;
      this.store.beginToolCall(key,name,fingerprint);
    }
    try {
      const result=await tool.execute(parsed);
      if(idempotencyKey)this.store.endToolCall(`${name}:${idempotencyKey}`,result);
      this.store.event('tool.completed',name);
      return result;
    } catch(error) {
      if(idempotencyKey)this.store.endToolCall(`${name}:${idempotencyKey}`,{error:'Provider action failed or has an uncertain outcome'},'uncertain');
      this.store.event('tool.failed',name);
      throw error;
    }
  }
  async operation(operation:string,input:any):Promise<unknown> {
    switch(operation) {
      case 'challenge.overview': return this.challenge();
      case 'ledger.record': return this.store.ledgerRecord(input,false);
      case 'ledger.list': return this.store.ledger().slice(0,input.limit||100);
      case 'memory.save': return this.store.put('memory',input,input.key);
      case 'memory.list': return this.store.list('memory',input.limit||100);
      case 'memory.search': return this.store.list('memory',500).filter(x=>JSON.stringify(x).toLowerCase().includes(input.query.toLowerCase())).slice(0,input.limit||20);
      case 'task.enqueue': case 'swarm.delegate': return this.store.enqueue(input);
      case 'task.list': return this.store.tasks(input.status,input.limit);
      case 'task.update': {
        const task=this.store.task(input.id);if(!task)throw new Error('Task not found');
        if(task.status==='running'||task.status==='recovering')throw new Error('The harness owns active task state');
        if(input.status&&!['queued','cancelled'].includes(input.status))throw new Error('Only the harness can attest task completion');
        return this.store.updateTask(input.id,{...(input.status?{status:input.status}:{}),...(input.result?{result:input.result}:{})});
      }
      case 'experiment.create': {
        if(input.budgetUsd>Math.max(0,this.config.initialCapitalUsd-this.store.totals().expenseUsd))throw new Error('Experiment exceeds remaining starting capital');
        return this.store.put('experiment',{...input,title:input.name,status:'proposed'});
      }
      case 'experiment.list':return this.store.list('experiment');
      case 'experiment.update':if(!this.store.get('experiment',input.id))throw new Error('Experiment not found');return this.store.put('experiment',input,input.id);
      case 'schedule.create': {
        if(input.intervalSeconds<60)throw new Error('Scheduled jobs require at least a 60-second interval');
        return this.store.put('schedule',{...input,nextRunAt:new Date(Date.now()+input.intervalSeconds*1000).toISOString()});
      }
      case 'schedule.list':return this.store.list('schedule');
      case 'schedule.remove':return {removed:this.store.remove('schedule',input.id)};
      case 'artifact.record':return this.store.put('artifact',input);
      case 'artifact.list':return this.store.list('artifact');
      case 'checkpoint.save':return this.store.put('checkpoint',input);
      case 'checkpoint.list':return this.store.list('checkpoint');
      case 'swarm.status':return {agents:roles,tasks:this.store.tasks(),paused:this.store.setting('paused',false)};
      case 'events.list':return this.store.events(input.limit);
      default:throw new Error('Unknown runtime operation');
    }
  }
  async reconcileStripe() {
    const key=this.env.STRIPE_SECRET_KEY;if(!key)throw new Error('STRIPE_SECRET_KEY is not configured');
    const challenge=this.challenge();if(!challenge.startedAt)throw new Error('Start the challenge before reconciling its revenue');
    const readPage=async(url:URL):Promise<{data:any[];has_more:boolean}>=>{
      const response=await fetch(url,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error(`Stripe reconciliation failed (${response.status})`);
      const body=await response.json() as {data:any[];has_more:boolean};
      if(!Array.isArray(body.data)||typeof body.has_more!=='boolean')throw new Error('Invalid Stripe reconciliation response');
      return body;
    };
    const startMs=Date.parse(challenge.startedAt),endMs=Date.parse(challenge.endsAt!);
    const url=new URL('https://api.stripe.com/v1/charges');url.searchParams.set('limit','100');url.searchParams.set('created[gte]',String(Math.floor(startMs/1000)));url.searchParams.set('created[lt]',String(Math.ceil(endMs/1000)));
    let count=0,refundCount=0,pages=0,more=true;
    while(more) {
      if(pages++>=20)throw new Error('Stripe reconciliation page limit reached; reconciliation is incomplete');
      const body=await readPage(url);
      for(const charge of body.data) {
        const occurredMs=Number(charge.created)*1000;
        if(charge.livemode===true&&charge.paid===true&&charge.captured===true&&charge.status==='succeeded'&&charge.currency==='usd'&&typeof charge.id==='string'&&Number.isSafeInteger(charge.amount_captured)&&charge.amount_captured>0&&Number.isFinite(occurredMs)&&occurredMs>=startMs&&occurredMs<endMs) {
          const relatedRef=`stripe:${charge.id}`;
          const entry=this.store.ledgerRecord({type:'income',amountUsd:charge.amount_captured/100,description:'Captured live Stripe customer payment',externalRef:relatedRef,occurredAt:new Date(occurredMs).toISOString(),receiptStatus:charge.disputed===true?'disputed':'valid'},true,'stripe');
          if(!entry.duplicate||entry.upgraded)count++;
          if(charge.amount_refunded>0) {
            const refundUrl=new URL('https://api.stripe.com/v1/refunds');refundUrl.searchParams.set('limit','100');refundUrl.searchParams.set('charge',charge.id);
            let refundMore=true,refundPages=0;
            while(refundMore) {
              if(refundPages++>=20)throw new Error('Stripe refund reconciliation page limit reached; reconciliation is incomplete');
              const refunds=await readPage(refundUrl);
              for(const refund of refunds.data) {
                if(refund.status==='succeeded'&&refund.currency==='usd'&&refund.charge===charge.id&&typeof refund.id==='string'&&Number.isSafeInteger(refund.amount)&&refund.amount>0&&Number.isFinite(Number(refund.created))) {
                  const record=this.store.ledgerRecord({type:'refund',amountUsd:refund.amount/100,description:'Successful Stripe customer refund',externalRef:`stripe:refund:${refund.id}`,relatedRef,occurredAt:new Date(Number(refund.created)*1000).toISOString()},true,'stripe');
                  if(!record.duplicate||record.upgraded)refundCount++;
                }
              }
              refundMore=refunds.has_more;
              if(refundMore) {const last=refunds.data.at(-1);if(!last?.id)throw new Error('Invalid Stripe refund pagination');refundUrl.searchParams.set('starting_after',last.id);}
            }
          }
        }
      }
      more=body.has_more;
      if(more) {const last=body.data.at(-1);if(!last?.id)throw new Error('Invalid Stripe charge pagination');url.searchParams.set('starting_after',last.id);}
    }
    this.store.event('finance.reconciled',`${count} Stripe receipts and ${refundCount} refunds verified`);
    return {newReceipts:count,newRefunds:refundCount,challenge:this.challenge()};
  }
}
