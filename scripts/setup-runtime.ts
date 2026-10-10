import { copyFile,readFile,writeFile,chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadEnvironment,loadLocalCredentials,getConfig } from '../src/config.js';
import { provisionWallet, assertVaultOutside } from '../src/wallet.js';

const root=process.cwd();const envPath=join(root,'.env');
if(!existsSync(envPath))await copyFile(join(root,'.env.example'),envPath);
await chmod(envPath,0o600);loadEnvironment();
let content=await readFile(envPath,'utf8');
function setEnv(name:string,value:string) {
  const line=`${name}=${value}`;const pattern=new RegExp(`^${name}=.*$`,'m');
  content=pattern.test(content)?content.replace(pattern,line):content.trimEnd()+`\n${line}\n`;
  process.env[name]=value;
}
try {
  const config=await readFile(join(homedir(),'.codex','config.toml'),'utf8');
  const selected=config.match(/^model\s*=\s*"([^"]+)"/m)?.[1];
  if(process.env.MODEL_PROVIDER==='chatgpt'&&selected)setEnv('EVE_MODEL',selected);
} catch {}
let wallet:{publicAddress:string;created:boolean}|undefined;
if(!process.env.SOLANA_WALLET_ADDRESS) {
  const config=getConfig();await assertVaultOutside(config.vaultDir,[config.root,config.workspace]);
  wallet=await provisionWallet(config.vaultDir);
  setEnv('SOLANA_WALLET_ADDRESS',wallet.publicAddress);
  setEnv('SOLANA_RPC_URL',process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com');
}
let modelLogin=false;
try {execFileSync('codex',['login','status'],{encoding:'utf8',windowsHide:true,timeout:10000,stdio:['ignore','pipe','pipe']});modelLogin=true;}catch{}
try {
  execFileSync('gh',['api','user','--jq','.login'],{encoding:'utf8',windowsHide:true,timeout:10000,stdio:['ignore','pipe','ignore']});
  if(!process.env.GITHUB_TOKEN)setEnv('GITHUB_AUTH_FROM_GH','true');
}catch{}
loadLocalCredentials();
await writeFile(envPath,content,{mode:0o600});
console.log('Solo Agentic bootstrap complete. Challenge clock remains unstarted.');
console.log(`Solana public address: ${process.env.SOLANA_WALLET_ADDRESS}`);
console.log(`Wallet: ${wallet?.created?'created locally':'existing configured/vault address reused'}; private key stays outside the repository in the owner-only vault.`);
console.log(`Model: ${process.env.EVE_MODEL}; local login ${modelLogin?'detected; verify a completed task':'requires account sign-in or a server model credential'}.`);
console.log('Next: npm run doctor; npm run background:start. Authenticate required accounts and fund the agent wallet/card, then start the challenge on your Mac mini.');
