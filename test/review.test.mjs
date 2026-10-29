import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Files } from '../plugins/files/dist/index.js';
import { Tables, declarationValidator } from '../plugins/tables/dist/index.js';
import { Documents } from '../plugins/documents/dist/index.js';
import { Annotations } from '../plugins/annotations/dist/index.js';

test('review decisions preserve exact reply versions, reasons, corrections and archive history',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rho-decisions-'));
 try{
 const files=new Files(root,'p'),documents=new Documents(root),annotations=new Annotations(root,{files,documents});
 await fs.writeFile(path.join(root,'figure.svg'),'<svg/>');const resource=await files.capture('figure.svg');
 let draft=await documents.open('question.md','browser:local');draft=await documents.edit(draft.id,draft.version,[{from:0,to:0,insert:'Please check this.'}],'draft','browser:local');
 let t=await annotations.create({annotationId:'q',changeId:'ask',expectedVersion:0,anchor:{kind:'resource',resource},draft:{documentId:draft.id,version:draft.version}},'browser:local');
 t=await annotations.reply({annotationId:'q',changeId:'reply',expectedVersion:t.version,replyTo:t.messages[0].id,draft:{documentId:draft.id,version:draft.version},resources:[resource]},'agent:test');
 const input={annotationId:'q',changeId:'decide',expectedVersion:t.version,targetMessageId:t.messages[1].id,resources:[{id:resource.id,version:resource.version}],status:'accepted'};
 await assert.rejects(annotations.decide(input,'agent:test'),e=>e.kind==='unauthorized');
 await assert.rejects(annotations.decide({...input,status:'needs-changes'},'browser:local',true),e=>e.kind==='invalid');
 const accepted=await annotations.decide(input,'browser:local',true);assert.equal(accepted.decisions.length,1);
 assert.equal((await annotations.decide(input,'browser:local',true)).decisions.length,1);
 await assert.rejects(annotations.decide({...input,status:'withdrawn'},'browser:local',true),e=>e.kind==='conflict');
 const withdrawn=await annotations.decide({...input,changeId:'withdraw',expectedVersion:accepted.version,status:'withdrawn',supersedes:accepted.decisions[0].id},'browser:local',true);
 assert.equal(withdrawn.decisions.length,2);assert.equal(withdrawn.messages.length,2);
 await fs.rm(path.join(root,'figure.svg'));assert.equal((await files.bytes(resource)).data.toString(),'<svg/>');
 await annotations.prepareRestore(await annotations.state());const bad=await annotations.state();bad[0].decisions[1].resources[0].version='0'.repeat(64);await assert.rejects(annotations.prepareRestore(bad),e=>e.kind==='invalid');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('multi-field comparison distinguishes missing rows, null and zero and preserves legacy output',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rho-diff-'));
 try{
 const files=new Files(root,'p',{},[declarationValidator]),tables=new Tables(files);
 const format={encoding:'json-rows',columns:[{name:'id',type:'string',nullValues:[]},...['n','mean'].map(name=>({name,type:'number',nullValues:[]}))],key:{column:'id',namespace:'observations'}};
 await fs.writeFile(path.join(root,'a.json'),JSON.stringify({rows:[{id:'a',n:0,mean:null},{id:'b',n:2,mean:3},{id:'gone',n:1,mean:2}]}));
 await fs.writeFile(path.join(root,'b.json'),JSON.stringify({rows:[{id:'b',n:4,mean:3},{id:'a',n:0,mean:2},{id:'new',n:null,mean:0}]}));
 const left=await files.capture('a.json',{declaration:{path:'a.json',kind:'table',format}}),right=await files.capture('b.json',{declaration:{path:'b.json',kind:'table',format}});
 const options={leftKey:'id',rightKey:'id',leftNamespace:'observations',rightNamespace:'observations',mapping:'equal-string',join:'full'};
 const r=await tables.compare(left,right,{...options,fields:[{leftField:'n',rightField:'n'},{leftField:'mean',rightField:'mean'}]});const page=await tables.page(r,0,10);
 assert.equal(page.rows.find(r=>r.key==='a').delta_0,0);assert.equal(page.rows.find(r=>r.key==='a').delta_1,null);
 assert.equal(page.rows.find(r=>r.key==='new').left_present,false);assert.equal(page.rows.find(r=>r.key==='new').after_0,null);
 assert.equal(page.rows.find(r=>r.key==='gone').right_present,false);assert.equal(page.rows.find(r=>r.key==='b').delta_0,2);
 const legacy=await tables.compare(left,right,{...options,leftField:'n',rightField:'n'});assert.deepEqual((await tables.page(legacy,0,1)).columns.map(c=>c.name),['key','x','y']);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('a fresh frozen context does not treat an older reply as a new response',async()=>{
 const {AgentContext}=await import('../plugins/agent/dist/index.js');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rho-review-context-'));
 try{
 const files=new Files(root,'p'),documents=new Documents(root),annotations=new Annotations(root,{files,documents}),context=new AgentContext(root,'p',{files,documents,annotations});
 await fs.writeFile(path.join(root,'x.txt'),'x');const resource=await files.capture('x.txt');
 let d=await documents.open('q.md','browser:local');d=await documents.edit(d.id,d.version,[{from:0,to:0,insert:'Check'}],'draft','browser:local');
 let thread=await annotations.create({annotationId:'q',expectedVersion:0,changeId:'q',anchor:{kind:'resource',resource},draft:{documentId:d.id,version:d.version}},'browser:local');
 thread=await annotations.reply({annotationId:'q',expectedVersion:thread.version,changeId:'old-reply',replyTo:thread.messages[0].id,draft:{documentId:d.id,version:d.version},resources:[resource]},'agent:test');
 const frozen=await context.createContext({changeId:'context',expectedVersion:0,annotations:[{annotationId:'q',version:thread.version}]},'browser:local');
 assert.equal((await context.readContext(frozen.contextId,'agent:test')).responses[0].state,'no-linked-response');
 await annotations.reply({annotationId:'q',expectedVersion:thread.version,changeId:'new-reply',replyTo:thread.messages[0].id,draft:{documentId:d.id,version:d.version},resources:[resource]},'agent:test');
 assert.equal((await context.readContext(frozen.contextId,'agent:test')).responses[0].state,'explicit-linked-response');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
