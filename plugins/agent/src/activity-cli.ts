#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { CoreActivityClient, collectActivity, summarizeActivity } from './activity-collect.js';
import type { SourceOptions } from './activity-reader.js';
import { inspectActivityArtifacts } from './activity-artifacts.js';

const help = `rho-agent-observe: read selected native Agent logs into an already-running Core

  rho-agent-observe collect --core /path/rho-core --socket /path/host.sock --caller NAME
    --stream ID --producer claude|dsh --project DIR --session ID --source PATH
    [--content] [--watch-seconds N] [--interval-ms N] [--max-source-bytes N]
    [--dsh-package /path/@deepseek-ai/dsh/package.json] [--compression zstd|none]
  rho-agent-observe summary --core PATH --socket PATH --caller NAME --stream ID
    [--project DIR --outputs RELATIVE_DIR]

Claude source: one native session JSONL file. dsh source: its session storage root;
the native read-only persistence API selects exactly --session. No Agent, model,
tool or Host is started. Content capture is explicit. Ctrl-C stops only observation.
`;

async function main() {
  const { values: v, positionals } = parseArgs({allowPositionals:true,options:{
    core:{type:'string'},socket:{type:'string'},caller:{type:'string'},stream:{type:'string'},
    producer:{type:'string'},project:{type:'string'},session:{type:'string'},source:{type:'string'},
    outputs:{type:'string'},
    'dsh-package':{type:'string'},compression:{type:'string'},content:{type:'boolean'},
    'watch-seconds':{type:'string'},'interval-ms':{type:'string'},'max-source-bytes':{type:'string'},help:{type:'boolean'},
  }});
  if (v.help) { process.stdout.write(help); return; }
  const need = (k: keyof typeof v): string => { const value=v[k]; if(typeof value!=='string'||!value)throw new Error(`--${k} is required`);return value; };
  const client = new CoreActivityClient({binary:need('core'),socket:need('socket'),caller:need('caller')}), stream=need('stream');
  if(positionals.length!==1)throw new Error('Choose collect or summary');
  if(positionals[0]==='summary') {
    let after=0,gap=false;const entries=[];
    for(;;){const p=client.call('activity-read',['--id',stream,'--after',String(after)]);entries.push(...p.entries);gap ||= p.gap;after=p.next_cursor;if(!p.more)break;if(entries.length>32768)throw new Error('Summary exceeds 32768 events; retained Core data is unchanged');}
    let artifacts;
    if(v.outputs){const project=need('project');const cap=client.call('capability');const fs=await import('node:fs/promises');if(await fs.realpath(project)!==cap.project_root)throw new Error('Output project does not match Core');artifacts=await inspectActivityArtifacts(project,v.outputs);}
    process.stdout.write(JSON.stringify({stream,gap,...summarizeActivity(entries),...(artifacts?{artifacts}: {})})+'\n');return;
  }
  if(positionals[0]!=='collect')throw new Error('Choose collect or summary');
  const producer=need('producer');if(producer!=='claude'&&producer!=='dsh')throw new Error('Unknown producer');
  const compression=v.compression??'zstd';if(compression!=='zstd'&&compression!=='none')throw new Error('Unknown compression');
  const seconds=Number(v['watch-seconds']??0),interval=Number(v['interval-ms']??1000),maxBytes=Number(v['max-source-bytes']??33554432);
  if(!Number.isFinite(seconds)||seconds<0||seconds>86400||!Number.isInteger(interval)||interval<100||interval>60000)throw new Error('Watch requires 0–86400 seconds and 100–60000 ms interval');
  const options: SourceOptions={producer,project:need('project'),session:need('session'),source:need('source'),content:v.content,
    dshPackage:v['dsh-package'],compression,maxSourceBytes:maxBytes};
  let stopped=false;const wake=new AbortController();
  const stop=()=>{stopped=true;wake.abort();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
  const end=Date.now()+seconds*1000;
  do {
    process.stdout.write(JSON.stringify(await collectActivity(client,options,stream))+'\n');
    if(stopped||Date.now()>=end)break;
    try { await delay(Math.min(interval,Math.max(1,end-Date.now())),undefined,{signal:wake.signal}); }
    catch(e) { if(!stopped)throw e; }
  } while(!stopped);
}
main().catch(e=>{process.stderr.write(`rho-agent-observe: ${e.message}\n`);process.exitCode=1;});
