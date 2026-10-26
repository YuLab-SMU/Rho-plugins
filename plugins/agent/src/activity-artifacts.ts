import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** A bounded current-filesystem observation, never a claim that a tool produced
 * these bytes. The caller selects an output directory inside the project. */
export async function inspectActivityArtifacts(project: string, directory: string,
  limits = {maxFiles: 64, maxEntries: 256, maxFileBytes: 8 * 1024 * 1024, maxDepth: 4}) {
  const root = await fs.realpath(project), selected = path.resolve(root, directory);
  const inside = (p: string) => { const r=path.relative(root,p); return r!==''&&!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r); };
  if (Object.values(limits).some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error('Output scan limits must be positive integers');
  if (!inside(selected) || await fs.realpath(selected) !== selected) throw new Error('Output directory must be inside the selected project without symlink traversal');
  const files: any[] = []; let entries = 0;
  const unchangedPath = async (name: string) => {
    if (!inside(name) || await fs.realpath(name) !== name) throw new Error('Output path changed or traverses a symlink');
  };
  async function walk(dir: string, depth: number) {
    if (depth > limits.maxDepth) throw new Error('Output scan exceeded maxDepth; retained activity is unchanged');
    await unchangedPath(dir);
    const handle = await fs.opendir(dir);
    for await (const entry of handle) {
      if (++entries > limits.maxEntries) throw new Error('Output scan exceeded maxEntries; retained activity is unchanged');
      const name = path.join(dir,entry.name), relative = path.relative(root,name);
      if (entry.isSymbolicLink()) {
        if (files.length >= limits.maxFiles) throw new Error('Output scan exceeded maxFiles; retained activity is unchanged');
        files.push({path:relative,state:'symlink-skipped'}); continue;
      }
      if (entry.isDirectory()) { await walk(name,depth+1); continue; }
      if (!entry.isFile()) continue;
      if (files.length >= limits.maxFiles) throw new Error('Output scan exceeded maxFiles; retained activity is unchanged');
      await unchangedPath(name);
      const file = await fs.open(name,constants.O_RDONLY|constants.O_NOFOLLOW);
      try {
        const before=await file.stat();
        if(!before.isFile()||before.size>limits.maxFileBytes){files.push({path:relative,state:'file-byte-limit'});continue;}
        const hash=createHash('sha256'),buffer=Buffer.alloc(65536);let bytes=0;
        for(;;){const read=await file.read(buffer,0,buffer.length,null);if(!read.bytesRead)break;bytes+=read.bytesRead;if(bytes>limits.maxFileBytes)throw new Error('Output grew beyond maxFileBytes during observation');hash.update(buffer.subarray(0,read.bytesRead));}
        await unchangedPath(name);
        const after=await file.stat(),current=await fs.lstat(name);
        if(bytes!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||current.ino!==before.ino||current.dev!==before.dev||!current.isFile())throw new Error('Output changed during observation; retry observation without rerunning the Agent');
        files.push({path:relative,state:'observed',bytes,sha256:hash.digest('hex'),
          kind_hint:['.csv','.tsv'].includes(path.extname(name))?'table':['.png','.svg','.jpg'].includes(path.extname(name))?'figure':'file',
          observed_at:new Date().toISOString(),provenance:'current-filesystem-observation',producer_confirmed:false});
      } finally {await file.close();}
    }
  }
  await walk(selected,0);return files.sort((a,b)=>a.path.localeCompare(b.path));
}
