import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnvironment, loadLocalCredentials, getConfig } from './config.js';
import { Runtime } from './runtime.js';
import { Supervisor } from './supervisor.js';
import { createHttpServer } from './http.js';

loadEnvironment();
loadLocalCredentials();
const config=getConfig();
config.apiToken ||= randomBytes(32).toString('hex');
config.internalToken ||= randomBytes(32).toString('hex');
if(!['127.0.0.1','localhost','::1'].includes(config.host)&&!process.env.SOLO_API_TOKEN)throw new Error('Set SOLO_API_TOKEN before binding outside loopback');
await mkdir(config.dataDir,{recursive:true});
const runtime=new Runtime(config);
const supervisor=new Supervisor(runtime);
const server=createHttpServer(runtime,supervisor);
server.on('error',error=>{console.error(`Solo Agentic could not listen: ${error.message}`);process.exit(1);});
await new Promise<void>(resolve=>server.listen(config.port,config.host,resolve));
await writeFile(join(config.dataDir,'service.pid'),String(process.pid));
await writeFile(join(config.dataDir,'service-state.json'),JSON.stringify({pid:process.pid,url:`http://127.0.0.1:${config.port}`,startedAt:new Date().toISOString()},null,2));
console.log(`Solo Agentic dashboard: http://127.0.0.1:${config.port}`);
console.log('The challenge clock remains in setup until explicitly started. Runtime records are private in data/.');
supervisor.start();
let stopping=false;
async function stop() {
  if(stopping)return;stopping=true;
  await supervisor.stop();
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  runtime.store.close();process.exit(0);
}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
