import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { stopAcpProcess } from '../plugins/agent/dist/acp-process.js';

test('ACP shutdown keeps escalation after the adapter wrapper exits', { timeout: 5000 }, async () => {
  const native = `process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000);`;
  const wrapper = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(native)}],{stdio:['ignore','pipe','ignore']});c.stdout.once('data',()=>{process.stdout.write(String(c.pid));c.stdout.destroy();});setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['-e', wrapper], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  let nativePid;
  try {
    nativePid = Number((await once(child.stdout, 'data'))[0].toString()); assert.ok(nativePid > 0);
    await stopAcpProcess(child.pid, 100);
    const active = () => { const s = spawnSync('ps', ['-p', String(nativePid), '-o', 'stat='], { encoding: 'utf8' }).stdout.trim(); return !!s && !s.startsWith('Z'); };
    for (let i = 0; i < 50 && active(); i++) await new Promise(r => setTimeout(r, 20));
    assert.equal(active(), false, 'the native child must not survive the wrapper exit');
  } finally { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
});
