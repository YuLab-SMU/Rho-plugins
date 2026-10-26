import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {normalizeClaude,normalizeDsh} from '../plugins/agent/dist/activity-normalize.js';
import {readActivitySource} from '../plugins/agent/dist/activity-reader.js';
import {summarizeActivity} from '../plugins/agent/dist/activity-collect.js';
import {inspectActivityArtifacts} from '../plugins/agent/dist/activity-artifacts.js';

const request=(cwd='/project')=>({type:'assistant',uuid:'message-a',sessionId:'s',cwd,timestamp:'2026-10-25T12:00:00Z',message:{content:[{type:'thinking',thinking:'NEVER_RETAIN_REASONING'},{type:'tool_use',id:'call-a',name:'Bash',input:{command:'python3 analysis.py',api_key:'PRIVATE_KEY',description:'run analysis'}}]}});
const result=(cwd='/project')=>({type:'user',uuid:'message-b',sessionId:'s',cwd,message:{content:[{type:'tool_result',tool_use_id:'call-a',is_error:true,content:'Exit code 7'}]}});

test('Claude observations retain commands and error basis without reasoning or default result bodies',()=>{
 const events=normalizeClaude([request(),result()],'s','/project');
 assert.equal(events.length,2);assert.equal(events[1].data.exit_code,7);
 assert.equal(events[0].data.input.command,'python3 analysis.py');
 assert.equal(events[0].data.detail,undefined);
 assert.doesNotMatch(JSON.stringify(events),/NEVER_RETAIN_REASONING|PRIVATE_KEY/);
 const content=normalizeClaude([request(),result()],'s','/project',{content:true});
 assert.equal(content[0].data.detail.api_key,'[redacted]');assert.equal(content[0].data.redacted,true);
 assert.equal(content[1].data.detail,'Exit code 7');
 const secret=request();secret.message.content[1].input.command='ANTHROPIC_AUTH_TOKEN="PRIVATE_INLINE" python3 analysis.py';
 assert.doesNotMatch(JSON.stringify(normalizeClaude([secret],'s','/project')),/PRIVATE_INLINE/);
});
test('native identity conflicts and cross-session/project observations are rejected',()=>{
 assert.throws(()=>normalizeClaude([request()],'other','/project'),/selected project/);
 assert.throws(()=>normalizeClaude([request()],'s','/elsewhere'),/selected project/);
 assert.equal(normalizeClaude([request(),request()],'s','/project').length,1);
 const changed=request();changed.message.content[1].input.command='different';
 assert.throws(()=>normalizeClaude([request(),changed],'s','/project'),/conflicting content/);
 const large=request();large.message.content[1].id='c'.repeat(1025);
 assert.throws(()=>normalizeClaude([large],'s','/project'),/cannot be clipped/);
 assert.equal(normalizeClaude([request()],'s','/project',{maxFieldBytes:1})[0].data.call_id,'call-a');
});
test('an earlier changed action changes the retained prefix even if the last return is unchanged',()=>{
 const a=normalizeClaude([request(),result()],'s','/project');const r=request();r.message.content[1].input.command='python3 different.py';
 const b=normalizeClaude([r,result()],'s','/project');assert.notEqual(a[1].data.prefix_sha256,b[1].data.prefix_sha256);
});
test('dsh job completion retains nonzero exit separately from successful tool return',()=>{
 const records=[{type:'tool/call',seq:1,time:1,data:{callId:'c',name:'bash',arguments:'{"command":"python3 failure.py"}'}},
 {type:'job/settled',seq:4,time:5,data:{toolCall:{callId:'c'},status:'completed',detail:'exit code: 7'}},
 {type:'tool/result',seq:5,time:6,data:{message:{toolCallId:'c',isError:false,content:[{type:'text',text:'[exit code: 7]'}]}}}];
 const events=normalizeDsh(records);const s=summarizeActivity(events.map((event,i)=>({event,cursor:i+1})));
 assert.equal(s.calls[0].tool_error,false);assert.equal(s.calls[0].exit_code,7);assert.equal(s.calls[0].exit_basis,'dsh-job-detail');
 assert.equal(s.calls[0].evidence.length,3);
 const pending=summarizeActivity([{event:events[0],cursor:1}]);assert.equal(pending.calls[0].observation,'result-unknown');
 assert.equal(normalizeDsh([records[0],records[0]]).length,1);
 assert.throws(()=>normalizeDsh([records[0],{...records[0],time:2}]),/conflicting content/);
 assert.throws(()=>normalizeDsh([records[2],records[0]]),/backwards/);
});
test('content clipping is Unicode safe and explicitly disclosed',()=>{
 const r=result();r.message.content[0].content='实验🧪'.repeat(100);
 const events=normalizeClaude([request(),r],'s','/project',{content:true,maxFieldBytes:31});
 assert.equal(events[1].data.truncated,true);assert.ok(Buffer.byteLength(events[1].data.detail)<=31);
 assert.doesNotMatch(events[1].data.detail,/\uFFFD/);
});
test('native JSONL reader ignores only incomplete tail, rejects corrupt complete rows and enforces source limits',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'rho-observe-'));
 try{
 const project=await fs.realpath(temp),file=path.join(temp,'session.jsonl');
 await fs.writeFile(file,JSON.stringify(request(project))+'\n{"partial":');
 const options={producer:'claude',project,session:'s',source:file};
 const first=await readActivitySource(options,'stream');assert.equal(first.events.length,1);assert.equal(first.pendingTail,true);
 await assert.rejects(readActivitySource({...options,maxSourceBytes:1},'stream'),/maxSourceBytes/);
 await fs.appendFile(file,'\n');await assert.rejects(readActivitySource(options,'stream'),/invalid complete JSON/);
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
test('artifact scan returns current digests, refuses external roots and skips symlinks',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'rho-artifacts-'));
 try{
 await fs.mkdir(path.join(temp,'outputs'));await fs.writeFile(path.join(temp,'outputs/table.csv'),'name,value\n甲,7\n');
 await fs.symlink('/etc/passwd',path.join(temp,'outputs/external'));
 const found=await inspectActivityArtifacts(temp,'outputs');
 assert.equal(found.find(f=>f.path.endsWith('.csv')).producer_confirmed,false);
 assert.match(found.find(f=>f.path.endsWith('.csv')).sha256,/^[a-f0-9]{64}$/);
 assert.equal(found.find(f=>f.path.endsWith('external')).state,'symlink-skipped');
 await assert.rejects(inspectActivityArtifacts(temp,'..'),/inside/);
 await fs.symlink(path.join(temp,'outputs'),path.join(temp,'alias'));
 await assert.rejects(inspectActivityArtifacts(temp,'alias'),/symlink/);
 await assert.rejects(inspectActivityArtifacts(temp,'outputs',{maxFiles:1,maxEntries:10,maxFileBytes:100,maxDepth:1}),/maxFiles/);
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
