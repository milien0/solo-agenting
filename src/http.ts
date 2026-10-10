import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { z } from 'zod';
import type { Runtime } from './runtime.js';
import type { Supervisor } from './supervisor.js';

export function equalSecret(a:string,b:string) {const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
export async function readJson(request:IncomingMessage) {
  let size=0;const chunks:Buffer[]=[];
  for await(const chunk of request){size+=chunk.length;if(size>1048576)throw new Error('Request body exceeds 1 MiB');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
}
function send(response:ServerResponse,status:number,body:unknown) {
  response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  response.end(JSON.stringify(body));
}
export function createHttpServer(runtime:Runtime,supervisor:Supervisor) {
  const config=runtime.config;
  if(!config.apiToken||!config.internalToken)throw new Error('Owner and internal API tokens must be nonempty');
  if(equalSecret(config.apiToken,config.internalToken))throw new Error('Owner and agent API tokens must be distinct');
  const bearer=(request:IncomingMessage)=>equalSecret(request.headers.authorization||'',`Bearer ${config.apiToken}`);
  const agentBearer=(request:IncomingMessage)=>equalSecret(request.headers.authorization||'',`Bearer ${config.internalToken}`);
  const cookie=(request:IncomingMessage)=>{
    const value=request.headers.cookie?.split(';').map(c=>c.trim()).find(c=>c.startsWith('solo_session='))?.slice('solo_session='.length)||'';
    return equalSecret(value,config.apiToken);
  };
  return createServer(async(request,response)=>{
    try {
      const host=request.headers.host||'';
      const allowedHosts=new Set([`127.0.0.1:${config.port}`,`localhost:${config.port}`,`${config.host}:${config.port}`]);
      if(!allowedHosts.has(host)){send(response,403,{error:'Unexpected Host header'});return;}
      const url=new URL(request.url||'/',`http://${host}`);
      const path=url.pathname;
      if(path==='/healthz'){send(response,200,{status:'ok',runtime:supervisor.status().mode});return;}
      if(path.startsWith('/api/')) {
        const internal=path.startsWith('/api/internal/');
        if(!(internal?agentBearer(request):(bearer(request)||cookie(request)))){send(response,401,{error:'Local owner session or API token required'});return;}
        if(request.method!=='GET'&&request.method!=='HEAD') {
          const origin=request.headers.origin;
          if(origin&&origin!==`http://${host}`){send(response,403,{error:'Cross-origin mutation refused'});return;}
          if(!origin&&!bearer(request)&&!(internal&&agentBearer(request))){send(response,403,{error:'Mutation requires same-origin browser request or bearer token'});return;}
          if(!request.headers['content-type']?.startsWith('application/json')){send(response,415,{error:'JSON content type required'});return;}
        }
        if(path==='/api/status'&&request.method==='GET') {
          const connectors=connectorStatus(runtime);
          const missing=connectors.flatMap(c=>c.ready?[]:c.requiredEnv);
          if(!supervisor.credentialsConfigured())missing.unshift('AI_GATEWAY_API_KEY or MODEL_PROVIDER=chatgpt');
          send(response,200,{challenge:runtime.challenge(),runtime:supervisor.status(),agents:supervisor.agents(),tasks:runtime.store.tasks(),tools:runtime.tools(),connectors,events:runtime.store.events(),experiments:runtime.store.list('experiment'),ledger:runtime.store.ledger(),artifacts:runtime.store.list('artifact'),setup:{missing,instructions:['Configure integrations in the private .env file, then restart the service.','Local ChatGPT mode reuses a Codex-owned login; hosted deployments need their own model API credential.','Connect the public Solana wallet address and Stripe account; never paste a wallet seed or card number into prompts.','The 30-day clock starts only when Start challenge is pressed. Preparation can run before funding.','Configure public/financial action flags only for the accounts and operations you have delegated.']}});
          return;
        }
        if(path==='/api/control'&&request.method==='POST') {
          const {action}=z.object({action:z.enum(['pause','resume','tick','start_challenge'])}).parse(await readJson(request));
          if(action==='pause')await supervisor.pause();
          if(action==='resume'){runtime.store.setSetting('paused',false);runtime.store.event('runtime.resumed','Task dispatch resumed');supervisor.startEngine();void supervisor.tick(true);}
          if(action==='tick')void supervisor.tick(true);
          if(action==='start_challenge')runtime.startChallenge();
          send(response,200,{ok:true,challenge:runtime.challenge(),runtime:supervisor.status()});return;
        }
        if(path==='/api/tasks'&&request.method==='POST') {
          const input=z.object({title:z.string().min(1).max(300),instructions:z.string().max(16000).optional(),role:z.enum(['orchestrator','researcher','builder','operator','finance']).optional()}).parse(await readJson(request));
          send(response,201,runtime.store.enqueue(input));void supervisor.tick();return;
        }
        if(path==='/api/experiments'&&request.method==='POST') {
          const input=z.object({title:z.string().min(1).max(300),hypothesis:z.string().min(1).max(8000),budgetUsd:z.number().finite().min(0).max(config.initialCapitalUsd)}).parse(await readJson(request));
          send(response,201,await runtime.operation('experiment.create',{...input,name:input.title}));return;
        }
        if(path==='/api/ledger'&&request.method==='POST') {
          const input=z.object({type:z.enum(['income','expense','funding','refund']),amountUsd:z.number().positive().finite(),description:z.string().min(1).max(1000),externalRef:z.string().min(1).max(500),occurredAt:z.string().datetime().optional(),relatedRef:z.string().min(1).max(500).optional()}).refine(value=>value.type!=='refund'||Boolean(value.relatedRef),{message:'A refund must identify its original receipt',path:['relatedRef']}).parse(await readJson(request));
          send(response,201,runtime.store.ledgerRecord(input,true,'owner'));return;
        }
        if(path==='/api/reconcile'&&request.method==='POST'){send(response,200,await runtime.reconcileStripe());return;}
        if(path==='/api/internal/discover'&&request.method==='POST') {
          const input=z.object({query:z.string().optional(),category:z.string().optional(),name:z.string().optional(),limit:z.number().int().min(1).max(30).default(12)}).parse(await readJson(request));
          const tools=runtime.tools();
          const matches=tools.filter(t=>(!input.name||t.name===input.name)&&(!input.category||t.category===input.category)&&(!input.query||`${t.name} ${t.description} ${t.category}`.toLowerCase().includes(input.query.toLowerCase())));
          send(response,200,{result:{matches:matches.slice(0,input.limit),totalMatches:matches.length,totalTools:tools.length,categories:[...new Set(tools.map(t=>t.category))]}});return;
        }
        if(path==='/api/internal/execute'&&request.method==='POST') {
          const input=z.object({name:z.string(),input:z.record(z.string(),z.unknown()),idempotencyKey:z.string().min(8).max(200).optional()}).parse(await readJson(request));
          send(response,200,{result:await runtime.execute(input.name,input.input,input.idempotencyKey)});return;
        }
        if(path==='/api/internal/reconcile'&&request.method==='POST'){send(response,200,{result:await runtime.reconcileStripe()});return;}
        send(response,404,{error:'API route not found'});return;
      }
      if(request.method!=='GET'){send(response,405,{error:'Method not allowed'});return;}
      const allowedFiles:Record<string,string>={'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/app.js':'app.js'};
      const file=allowedFiles[path];if(!file){send(response,404,{error:'Not found'});return;}
      const isLoopback=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress||'');
      if(!isLoopback&&!bearer(request)&&!cookie(request)){send(response,401,{error:'Authenticate using SOLO_API_TOKEN through a private authenticated reverse proxy'});return;}
      const body=await readFile(join(config.root,'public',file));
      const types:Record<string,string>={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
      response.writeHead(200,{'Content-Type':types[extname(file)],'Set-Cookie':`solo_session=${config.apiToken}; HttpOnly; SameSite=Strict; Path=/`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});
      response.end(body);
    } catch(error) {
      const text=error instanceof Error?error.message:'Request failed';
      const safe=text.replace(/(?:sk_|ghp_|gho_|Bearer )[A-Za-z0-9_\-.]+/g,'[redacted]').slice(0,1000);
      if(!response.headersSent)send(response,400,{error:safe});else response.end();
    }
  });
}
import { connectorDefinitions } from './runtime.js';
function connectorStatus(runtime:Runtime) {
  return connectorDefinitions.map(c=>({...c,ready:c.requiredEnv.every(name=>Boolean(runtime.env[name]))}));
}
