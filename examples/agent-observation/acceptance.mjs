#!/usr/bin/env node
// Uses only the selected Core public CLI and this plugin's public modules.
// The native Agent has already run; this check never starts or resumes it.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {CoreActivityClient,collectActivity,summarizeActivity} from '../../plugins/agent/dist/activity-collect.js';
import {inspectActivityArtifacts} from '../../plugins/agent/dist/activity-artifacts.js';

const {values:v}=parseArgs({options:Object.fromEntries(['core','producer','project','session','source','dsh-package','out'].map(k=>[k,{type:'string'}]))});
for(const k of ['core','producer','project','session','source'])assert.ok(v[k],`--${k} is required`);
assert.ok(['claude','dsh'].includes(v.producer));
const state=await fs.mkdtemp(path.join(os.tmpdir(),'rho-activity-'));
const client=new CoreActivityClient({binary:v.core,socket:path.join(state,'host.sock'),caller:'observation-acceptance'});
const options={producer:v.producer,project:v.project,session:v.session,source:v.source,dshPackage:v['dsh-package'],content:true};
let host,diagnostics='';
async function start(){
 host=spawn(v.core,['serve','--project',v.project,'--state-dir',state],{stdio:['ignore','pipe','pipe']});
 diagnostics='';host.stdout.on('data',()=>{});host.stderr.on('data',b=>{diagnostics=(diagnostics+b).slice(-8192);});
 for(let i=0;i<100;i++){
  if(host.exitCode!==null)throw new Error(`Owned Host exited: ${diagnostics}`);
  try{await fs.stat(client.connection.socket);assert.deepEqual(client.call('capability').executors,[]);return;}catch{}
  await delay(50);
 }
 throw new Error('Owned observation Host did not become ready');
}
async function stop(signal='SIGTERM'){
 if(!host||host.exitCode!==null||host.signalCode!==null)return;
 const ended=new Promise(resolve=>host.once('exit',resolve));host.kill(signal);await ended;
}
function read(){
 const entries=[];let after=0;
 for(;;){const p=client.call('activity-read',['--id','native-session','--after',String(after)]);assert.equal(p.gap,false);entries.push(...p.entries);after=p.next_cursor;if(!p.more)return entries;}
}
try{
 await start();
 const first=await collectActivity(client,options,'native-session');assert.ok(first.appended>0);
 const entries=read(),second=await collectActivity(client,options,'native-session');assert.equal(second.appended,0);
 const summary=summarizeActivity(entries);assert.ok(summary.calls.some(c=>c.exit_code===7),'Intentional diagnostic exit 7 must have native evidence');
 assert.equal(client.call('list').runs.length,0,'External tool calls must not become managed runs');
 await stop('SIGKILL');await start();assert.deepEqual(read(),entries);
 const resumed=await collectActivity(client,options,'native-session');assert.equal(resumed.appended,0);
 const artifacts=await inspectActivityArtifacts(v.project,'outputs');
 assert.ok(artifacts.some(a=>a.path==='outputs/summary.csv'&&a.state==='observed'));
 assert.ok(artifacts.some(a=>a.path==='outputs/plot.svg'&&a.state==='observed'));
 const report={producer:v.producer,first,second,resumed,summary,artifacts,checks:['native-log-backfill','same-identity-deduplication','killed-host-restart','no-managed-execution','current-artifact-digests']};
 if(v.out)await fs.writeFile(v.out,JSON.stringify(report,null,2)+'\n');
 process.stdout.write(JSON.stringify({producer:v.producer,events:entries.length,calls:summary.calls.length,exit7:summary.calls.filter(c=>c.exit_code===7).length,artifacts:artifacts.length,checks:report.checks})+'\n');
}finally{await stop();await fs.rm(state,{recursive:true,force:true});}
