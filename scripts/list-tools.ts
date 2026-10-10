import { loadEnvironment,loadLocalCredentials,getConfig } from '../src/config.js';
import { Runtime } from '../src/runtime.js';
loadEnvironment();
loadLocalCredentials();
const runtime=new Runtime(getConfig());
for(const tool of runtime.tools())console.log(`${tool.available?'ready':'setup'}\t${tool.category}\t${tool.name}\t${tool.description}`);
console.log(`\n${runtime.capabilities.length} capabilities. ${runtime.tools().filter(t=>t.available).length} configuration-ready.`);
runtime.store.close();
