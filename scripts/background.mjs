import { spawnSync } from 'node:child_process';
import { mkdirSync,writeFileSync,existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const action=process.argv[2];if(!['start','stop'].includes(action))throw new Error('Expected start or stop');
if(process.platform==='win32') {
  const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts',`${action}-background.ps1`)],{cwd:root,stdio:'inherit',windowsHide:true});process.exit(result.status??1);
}
if(process.platform!=='darwin')throw new Error('Use Docker Compose or npm start on Linux; native background registration supports macOS and Windows');
const label='com.soloagentic.runtime';const domain=`gui/${process.getuid?.()}`;const service=`${domain}/${label}`;
const plistPath=join(homedir(),'Library','LaunchAgents',`${label}.plist`);
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function launch(args,required=true) {const result=spawnSync('/bin/launchctl',args,{encoding:'utf8',stdio:required?'inherit':'ignore'});if(required&&result.status!==0)throw new Error(`launchctl ${args[0]} failed`);}
if(action==='stop'){launch(['bootout',service],false);launch(['disable',service],false);console.log('Solo Agentic launchd service stopped; durable state retained.');process.exit(0);}
for(const name of ['.env.local','.env']) {const path=join(root,name);if(existsSync(path))process.loadEnvFile(path);}
const dataDir=resolve(root,process.env.DATA_DIR||'data');
const dashboardUrl=`http://127.0.0.1:${process.env.PORT||4310}`;
mkdirSync(dataDir,{recursive:true});mkdirSync(dirname(plistPath),{recursive:true});
const paths=[dirname(process.execPath),join(root,'node_modules','.bin'),process.env.PATH||'/usr/bin:/bin'].join(':');
const xml=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>--import</string><string>tsx</string><string>${escape(join(root,'src/server.ts'))}</string></array><key>WorkingDirectory</key><string>${escape(root)}</string><key>EnvironmentVariables</key><dict><key>PATH</key><string>${escape(paths)}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${escape(join(dataDir,'service.log'))}</string><key>StandardErrorPath</key><string>${escape(join(dataDir,'service-error.log'))}</string></dict></plist>\n`;
launch(['bootout',service],false);writeFileSync(plistPath,xml,{mode:0o600});
launch(['enable',service],false);launch(['bootstrap',domain,plistPath]);launch(['kickstart',service]);
console.log(`Solo Agentic registered with macOS launchd. Dashboard: ${dashboardUrl}`);
console.log('This user service resumes at login and needs the Mac awake and connected.');
