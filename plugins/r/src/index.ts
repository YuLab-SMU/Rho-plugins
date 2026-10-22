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
  const output = path.join(parent, 'artifacts');
  requireThat(new Set(input.artifacts.map((d: Declaration) => d.path)).size === input.artifacts.length, 'invalid', 'Output paths must be unique.');
  for (const d of input.artifacts) { resources.validateDeclaration(d); await confined(parent, 'artifacts/' + d.path, true); }
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
const rSkill = declaredSkill('r.workspace', 'Use capability.list to discover object.read and action.submit. Reads address exported snapshots; native execution is explicit and retains its original operation identity.');
export const plugin = { entryVersion: '1.0', id: 'r', package: '@rho-workspace/plugin-r', version: '0.4.1', requires: ['files'], capabilities: ['r-objects'], presentation, actions,
  operations: Object.entries(operationContracts).map(([method, contract]) => ({ method, presentation: operationPresentation[method as keyof typeof operationPresentation], version: '2.0' as const, ...structuredClone(contract), requires: [...contract.requires] })),
  skills: [{ ...rSkill, presentation: skillPresentation }], components: [{ id: 'rho.object', version: '0.2.0', owner: 'rho-plugins.object', bindings: { data: 'object' }, ui: 'unavailable', presentation: viewPresentation, propsSchema: obj({ title: text }) }] };
