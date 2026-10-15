import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parse } from 'csv-parse/sync';
import { confined, digest, now, readJson, requireThat, stateDirectory, type ResourceRef } from './common.js';
import { Documents } from './documents.js';
import { libraryPrefix, type Environment } from './requirements.js';
import { Resources, publicResource } from './resources.js';
export interface ActionPlan { code: string; args: string[]; source: Record<string, any>; output: string | null }
export const recipePath = fileURLToPath(new URL('../examples/real-r-analysis/analyze.R', import.meta.url));
export async function planAnalysis(root: string, actionId: string, input: any, operationId: string, environment: Environment, resources: Resources, documents = new Documents(root)): Promise<ActionPlan> {
  const parent = await stateDirectory(root, '.rho/plugins/runs/' + digest(operationId));
  const output = path.join(parent, 'artifacts');
  let snapshot;
  if (actionId === 'airway.analyze') {
    if (input.script?.kind === 'buffer') snapshot = await documents.snapshot(input.script.documentId, input.script.version);
    else {
      requireThat(!input.script || !input.script.path.split('/').some((p: string) => ['.rho', '.git'].includes(p)), 'scope', 'Select a script outside internal owner state.');
      const file = input.script ? await confined(root, input.script.path) : recipePath;
      requireThat((await fs.stat(file)).size <= documents.limits.maxBufferBytes, 'limit', 'Saved script exceeds the configured buffer byte limit.', { limit: 'maxBufferBytes' });
      let code: string;
      try { code = new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(file)); }
      catch { requireThat(false, 'invalid', 'Saved script is not valid UTF-8.'); }
      requireThat(!input.script || digest(code) === input.script.digest, 'stale', 'Saved script bytes changed before submission.');
      snapshot = { code, sha256: digest(code), source: { kind: 'disk', path: input.script?.path ?? 'rho-plugins:examples/real-r-analysis/analyze.R' } };
    }
    return { code: libraryPrefix(environment) + snapshot.code, args: [output, String(input.bootstrapReplicates)], source: { ...snapshot.source, sha256: snapshot.sha256, dataset: 'airway/GSE52778', expectedGenes: 16139, contrast: 'dex:trt:untrt' }, output: path.relative(root, output) };
  }
  const model = await resources.resolve(input.model as ResourceRef), baseline = await resources.resolve(input.baseline as ResourceRef);
  requireThat(model.kind === 'model' && baseline.kind === 'table' && model.provenance.operationId === baseline.provenance.operationId, 'condition', 'Choose a model and table from the same accepted analysis.');
  requireThat(model.path.endsWith('/models/full.rds') && baseline.path.endsWith('/results/full.csv'), 'condition', 'Shrinkage uses the paired full model and its matching baseline table.');
  const code = await fs.readFile(new URL('../headless/native/shrink.R', import.meta.url), 'utf8');
  return { code: libraryPrefix(environment) + code, args: [output, await confined(root, model.storage), await confined(root, baseline.storage)], source: { kind: 'component-recipe', sha256: digest(code), model: input.model, baseline: input.baseline, contrast: 'dex:trt:untrt', coefficient: 'dex_trt_vs_untrt', method: 'apeglm' }, output: path.relative(root, output) };
}
export async function collectArtifacts(root: string, projectId: string, run: any, resources: Resources) {
  if (!run.plan.output) return { resources: [], integrity: { state: 'not-applicable' }, domain: { state: 'not-applicable' } };
  const directory = await confined(root, run.plan.output, true);
  let complete: any = null;
  try { complete = await readJson(path.join(directory, 'complete.json')); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  let files: string[] = [];
  async function walk(dir: string) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      requireThat(!e.isSymbolicLink(), 'scope', 'Artifact inventory contains a symbolic link.');
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p); else if (e.isFile()) files.push(p);
      requireThat(files.length <= 128, 'limit', 'Artifact inventory exceeds 128 files.', { limit: 'maxArtifactFiles' });
    }
  }
  try { await walk(directory); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  const collected = [];
  for (const file of files.filter(f => !f.endsWith('.partial'))) {
    const coverage: any = { completionDeclaration: complete ? 'present' : 'absent', observedAt: now() };
    if (file.endsWith('.csv') && (await fs.stat(file)).size <= resources.limits.maxFileBytes) {
      try {
        const rows: any[] = parse(await fs.readFile(file), { columns: true, skip_empty_lines: true, max_record_size: 1024 * 1024 });
        coverage.observedRows = rows.length;
        if (file.endsWith('/results/full.csv') || file.endsWith('/shrinkage.csv')) { coverage.expectedGenes = 16139; coverage.finiteEffects = rows.filter(r => r.log2FoldChange !== '' && Number.isFinite(Number(r.log2FoldChange))).length; }
      } catch { coverage.reader = 'incomplete-or-unreadable'; }
    }
    collected.push(publicResource(await resources.register(path.relative(root, file), { operationId: run.operationId, core: run.core, action: run.action, actionVersion: run.actionVersion, codeDigest: digest(run.plan.code), source: run.plan.source, ...run.plan.source }, complete ? 'available' : 'partial', coverage)));
  }
  return { resources: collected, integrity: complete ? { state: 'declared', declaration: complete } : { state: 'incomplete', completionDeclaration: 'absent' }, domain: { state: 'unchecked', scope: 'No scientific checker result has been obtained.' } };
}
async function nativeCheck(program: string, args: string[], input?: string) {
  return new Promise<number>(resolve => {
    const child = spawn(program, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.on('error', () => { clearTimeout(timer); resolve(-1); });
    child.on('close', code => { clearTimeout(timer); resolve(code ?? -1); }); child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
export async function verifyArtifacts(root: string, run: any, rscript: string) {
  requireThat(run.plan.output, 'condition', 'This operation has no scientific artifacts.');
  const dir = await confined(root, run.plan.output);
  const complete = await readJson<any>(path.join(dir, 'complete.json'));
  const summaryBytes = await fs.readFile(path.join(dir, 'summary.json'));
  const manifestBytes = await fs.readFile(path.join(dir, 'artifact_manifest.csv'));
  requireThat(complete.state === 'complete' && digest(summaryBytes) === complete.summary_sha256 && digest(manifestBytes) === complete.manifest_sha256, 'condition', 'Completion declaration digest verification failed.');
  const manifest: any[] = parse(manifestBytes, { columns: true });
  requireThat(manifest.length <= 128, 'limit', 'Manifest file limit exceeded.', { limit: 'maxArtifactFiles' });
  for (const item of manifest) {
    const file = await confined(dir, item.path);
    const stat = await fs.stat(file);
    requireThat(stat.size <= 64 * 1024 * 1024, 'limit', 'Manifest entry exceeds file limit.', { limit: 'maxFileBytes' });
    const bytes = await fs.readFile(file);
    requireThat(bytes.length === Number(item.bytes) && digest(bytes) === item.sha256, 'condition', 'Manifest entry failed byte verification.', { artifact: item.path });
  }
  const reportDir = await stateDirectory(root, '.rho/plugins/checks/' + run.core.requestId);
  const nonce = String(Date.now());
  const domainReport = path.join(reportDir, nonce + '-domain.json');
  const nativeReport = path.join(reportDir, nonce + '-native.json');
  let domainExit, nativeExit;
  if (run.action === 'airway.analyze') {
    domainExit = await nativeCheck(process.env.RHO_PYTHON ?? 'python3', [fileURLToPath(new URL('../examples/real-r-analysis/verify.py', import.meta.url)), dir, '--report', domainReport]);
    const code = libraryPrefix(run.checks.environment) + await fs.readFile(new URL('../examples/real-r-analysis/inspect-models.R', import.meta.url), 'utf8');
    nativeExit = await nativeCheck(rscript, ['--vanilla', '-', dir, nativeReport], code);
  } else {
    const baseline = await new Resources(root, run.projectId).resolve(run.plan.source.baseline);
    const code = libraryPrefix(run.checks.environment) + await fs.readFile(new URL('../headless/native/verify-shrink.R', import.meta.url), 'utf8');
    nativeExit = await nativeCheck(rscript, ['--vanilla', '-', dir, nativeReport, await confined(root, baseline.storage)], code);
    domainExit = nativeExit;
  }
  return { integrity: { state: 'verified', files: manifest.length, checkedAt: now(), manifestDigest: digest(manifestBytes) }, domain: { state: domainExit === 0 && nativeExit === 0 ? 'passed' : 'failed', checkedAt: now(), arithmeticExit: domainExit, nativeExit, arithmetic: await readJson(domainReport, null), native: await readJson(nativeReport, null), scope: 'Artifact arithmetic and saved native state checks; not independent biological or clinical validation.' } };
}
