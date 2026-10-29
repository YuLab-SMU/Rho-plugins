import { skillPresentation, presentation, operationPresentation, viewPresentation } from './presentation.js';
import { observeExecutable } from '@rho-workspace/plugin-contracts';

export async function observeNativeAvailability(rscript: string) {
  const observation = await observeExecutable(rscript);
  return { ...observation, tool: 'Rscript', methods: ['action.submit'],
    ...(observation.state === 'missing' ? { title: "Can't run scripts on this machine", body: 'No executable Rscript was found at the selected location. Reading objects that were already exported still works. Whoever runs Rho can install R or select its Rscript.' } :
      observation.state === 'unknown' ? { title: 'Rscript availability is unknown', body: 'The selected executable could not be checked. Reading exported objects still works. Whoever runs Rho can check the selected Rscript location.' } : {}) };
}
import { operationContracts } from './operations.js';
import { publicResource, objectSchema as obj, text, type ResourceRef, type ResourceStore, type DocumentSnapshotSource, type ActionPlan } from '@rho-workspace/plugin-contracts';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { confined, digest, requireThat, stateDirectory } from '@rho-workspace/plugin-contracts';
import { validateDeclarationEnvelope, type Declaration } from '@rho-workspace/plugin-contracts';

export interface Environment { rscript: string; libraryPaths: string[] }
export const executionLimits = { maxScriptBytes: 1024 * 1024 };

export async function planExecution(root: string, input: any, operationId: string, environment: Environment, resources: Pick<ResourceStore, 'resolve' | 'validateDeclaration'> & { sourceFile?: (relative: string) => Promise<{ file: string; relative: string }> }, documents?: DocumentSnapshotSource, limits: Partial<typeof executionLimits> = {}): Promise<ActionPlan> {
  const maximum = limits.maxScriptBytes ?? executionLimits.maxScriptBytes;
  root = await fs.realpath(root);
  let snapshot;
  if (input.script.kind === 'buffer') { requireThat(documents, 'unavailable', 'The documents plugin is required for buffer execution.'); snapshot = await documents.snapshot(input.script.documentId, input.script.version); }
  else {
    requireThat(!input.script.path.split('/').some((p: string) => ['.rho', '.git'].includes(p)), 'scope', 'Select a script outside internal owner state.');
    const file = resources.sourceFile ? (await resources.sourceFile(input.script.path)).file : await confined(root, input.script.path);
    requireThat((await fs.stat(file)).size <= maximum, 'limit', 'Saved script exceeds the R script byte limit.', { limit: 'maxScriptBytes', maximum });
    let code: string;
    try { code = new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(file)); }
    catch { requireThat(false, 'invalid', 'Saved script is not valid UTF-8.'); }
    requireThat(digest(code) === input.script.digest, 'stale', 'Saved script bytes changed before submission.');
    snapshot = { code, sha256: digest(code), source: { kind: 'disk', path: input.script.path } };
  }
  requireThat(Buffer.byteLength(snapshot.code) <= maximum, 'limit', 'Script snapshot exceeds the R script byte limit.', { limit: 'maxScriptBytes', maximum });
  const parent = await stateDirectory(root, '.rho/plugins/runs/' + digest(operationId));
  requireThat(new Set(input.artifacts.map((d: Declaration) => d.path)).size === input.artifacts.length, 'invalid', 'Output paths must be unique.');
  // The declared output directory is handed to R as its first argument, so it must
  // exist before the run: a script that opens a file there fails otherwise.
  const output = await stateDirectory(root, path.relative(root, path.join(parent, 'artifacts')));
  for (const d of input.artifacts) {
    resources.validateDeclaration(d);
    await confined(parent, 'artifacts/' + d.path, true);
    // A declared path may name a subdirectory; that directory is part of the
    // declaration, not an accident of the script.
    const inside = path.posix.dirname(d.path.split(path.sep).join('/'));
    if (inside && inside !== '.') await stateDirectory(output, inside);
  }
  const completionPath = input.completion === null ? null : await confined(parent, input.completion, true);
  const inputs = [], args = [output];
  for (const arg of input.args) {
    if (typeof arg === 'string') args.push(arg);
    else { const r = await resources.resolve(arg.resource); inputs.push(arg.resource); args.push(await confined(root, r.storage)); }
  }
  return { code: ('.libPaths(c(c(' + environment.libraryPaths.map(x => JSON.stringify(x)).join(',') + '), .libPaths()))\n') + snapshot.code, args, source: { ...snapshot.source, sha256: snapshot.sha256, inputs, artifacts: input.artifacts, completion: input.completion, requirements: input.requirements }, output: path.relative(root, output), completion: completionPath && path.relative(root, completionPath) };
}
import { createExecutionInputSchema } from './contract.js';

const declaredSkill = (id: string, content: string, version = '1.0') => ({ id, version, content, digest: digest(content) });
export { createExecutionInputSchema, scriptSchema } from './contract.js';
export const actions = [{ id: 'r.execute', version: '0.2.0', presentation: operationPresentation['action.submit'], owner: 'rho-plugins.r', requires: ['requirements'], capabilities: ['r-execution'], effects: ['native-execution', 'create-declared-artifacts'], cancellation: 'Core cancellation request; native stop requires observation', inputSchema: createExecutionInputSchema() }];

export function validateObjectDeclaration(d: Declaration) {
  validateDeclarationEnvelope(d); requireThat(d.kind === 'object' && (d.format as any).encoding === 'json' && (d.format as any).observation === 'exported-snapshot' && Array.isArray((d.format as any).classes), 'invalid', 'Objects must be explicit exported JSON snapshots.');
}
export const declarationValidator = { kind: 'object', validate: validateObjectDeclaration };
export class Objects {
  constructor(public files: Pick<ResourceStore, 'bytes'> & { limits: { maxReadBytes: number } }) {}
  async read(ref: ResourceRef) {
    const { r, data } = await this.files.bytes(ref);
    requireThat(r.kind === 'object' && typeof r.format === 'object' && r.format.observation === 'exported-snapshot', 'invalid', 'Select an exported object snapshot.');
    requireThat(data.length <= this.files.limits.maxReadBytes, 'limit', 'Object snapshot exceeds the structured read budget; bounded byte reads remain available.', { limit: 'maxReadBytes' });
    return { resource: publicResource(r), observation: 'exported-snapshot', value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)) };
  }
}
// Written after running this path by hand and getting each step wrong once. The
// content is what an Agent needs to succeed first time; the extra fields are what a
// check can hold to account.
const rSkillContent = [
  'Use native tools normally. Choose this managed R entry only when execution continuity',
  'or a retained application operation is needed. It runs user-written R scripts, which',
  'may invoke other native programs under existing permissions. Core is optional.',
  'For a managed run, use capability.list to discover object.read, action.submit and',
  'artifact.check in this session; reads address exported snapshots and execution is one',
  'explicit submit that keeps its original operation identity.',
  '',
  '1. Find the script. A disk script must match its declared digest; a buffer script is',
  '   pinned by documentId and version. The bytes sent are the bytes in this request.',
  '   If a body is not certain, protocol.validate { method, body } answers with the edit',
  '   each problem needs before anything is sent.',
  '2. Declare what the run produces, not what it might produce: artifacts carry path,',
  '   kind and format, and their paths stay inside the run output directory.',
  '3. The output directory exists before R starts and is handed to R as its first',
  '   argument (commandArgs(trailingOnly = TRUE)[1]). Write there directly; do not build',
  '   the directory and do not use the working directory for outputs.',
  '4. If you need artifact verification, declare completion: its filename is relative to',
  '   the run directory, beside artifacts/, and the producer writes',
  '   {"schemaVersion":1,"complete":true,"artifacts":[{"path","bytes","sha256"}]}.',
  '   artifact.check reads that inventory; without it there is nothing to verify.',
  '5. Read the outcome. A read of the operation reports the current outcome, so no',
  '   separate observe is required: action.lookup and action.list reconcile a run that',
  '   finished while nobody was watching. When the Host gives no answer the run stays',
  '   active and the outcome is genuinely unknown; do not resubmit under a new identity.',
  '6. A run belongs to whoever submitted it: only that session retries it. That session',
  '   or the person, from a tab paired with this project, may stop it; cancellation.',
  '   requestedBy names who asked, and a run the person stopped is not resubmitted unasked.',
  '   Any session of this project reads a run by operationId (lookup, observe, output,',
  '   artifact.check), so a run the person started from your proposed form is yours to',
  '   follow. To repair a failed run, submit a new operationId with repairOf naming it.',
  '',
  'An executed artifact lives under owner state (.rho/plugins/runs/...). It is verified',
  'through artifact.check; it is not a project resource, so resource.register refuses it',
  'and an Agent-run figure cannot be shown in a view. Do not claim it is presented.'
].join('\n');
const rSkill = {
  ...declaredSkill('r.workspace', rSkillContent, '1.1'),
  intent: 'Run an R script in this project and keep its produced artifacts.',
  requires: ['action.submit', 'action.lookup', 'artifact.check'],
  example: {
    method: 'action.submit',
    input: {
      operationId: 'analysis-1', action: 'r.execute', actionVersion: '0.2.0',
      input: {
        script: { kind: 'disk', path: 'R/plot.R', digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
        args: [], requirements: [],
        artifacts: [{ path: 'cars.png', kind: 'file', format: { mimeType: 'image/png' } }],
        completion: 'inventory.json'
      }
    }
  },
  failureRecipes: [
    { kind: 'scope', message: 'Use a project-relative path without parent traversal.', next: 'Address the script and every artifact inside the project; the run output directory is the only writable output location.' },
    { kind: 'stale', message: 'Saved script bytes changed before submission.', next: 'Re-read the script, take its current digest, and submit once with that digest.' },
    { kind: 'not_found', message: 'Requested owner record or file is missing.', next: 'Look the operation up from the session that submitted it; facts are keyed by principal.' },
    { kind: 'condition', message: 'No complete artifact inventory has been declared.', next: 'Declare completion and write that inventory from the producer before calling artifact.check.' },
    { kind: 'unavailable', message: 'Requested executable is unavailable.', next: 'Select the Core binary and Rscript explicitly, then retry the same operation identity.' }
  ],
  verify: { command: 'npm run acceptance:execution', description: 'Submits r.execute for a script that writes an artifact into the directory it is handed, then asserts one Host start, the artifact, its completion inventory and artifact.check.' }
};
export const plugin = { entryVersion: '1.0', id: 'r', package: '@rho-workspace/plugin-r', version: '0.4.1', requires: ['files'], capabilities: ['r-objects'], presentation, actions,
  operations: Object.entries(operationContracts).map(([method, contract]) => ({ method, presentation: operationPresentation[method as keyof typeof operationPresentation], version: '2.0' as const, ...structuredClone(contract), requires: [...contract.requires] })),
  skills: [{ ...rSkill, presentation: skillPresentation }], components: [{ id: 'rho.object', version: '0.2.0', owner: 'rho-plugins.object', bindings: { data: 'object' }, ui: 'unavailable', presentation: viewPresentation, propsSchema: obj({ title: text }) }] };
