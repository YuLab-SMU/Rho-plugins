import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const base = '.rho-figures';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = value => JSON.stringify(String(value));
export const limits = { sourceBytes: 8388608, figureBytes: 786432, figures: 32, selectionKeys: 32 };
const idPattern = /^[a-f0-9]{32}$/;

// Existing paths must resolve inside the project; neither a link nor an absolute
// path extends the project. Output directories are checked again before writes.
async function contained(root, relative) {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Use a project-relative path without ..');
  const realRoot = await fs.realpath(root), candidate = await fs.realpath(path.join(realRoot, relative));
  if (!candidate.startsWith(realRoot + path.sep)) throw new Error('Path leaves the project.');
  return candidate;
}
async function readBounded(file, maxBytes) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error(`File exceeds the ${maxBytes}-byte read limit or is not a regular file.`);
    const bytes = Buffer.alloc(maxBytes + 1); const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > maxBytes) throw new Error('File grew past the read limit.');
    return bytes.subarray(0, bytesRead);
  } finally { await handle.close(); }
}
async function directory(root, create = false) {
  if (create) await fs.mkdir(path.join(root, base), { recursive: true });
  return contained(root, base);
}
async function figure(root, id) {
  if (!idPattern.test(id)) throw new Error('Invalid figure identity.');
  const dir = await contained(root, `${base}/${id}`);
  const bytes = await readBounded(await contained(root, `${base}/${id}/figure.json`), limits.figureBytes);
  const value = JSON.parse(bytes); if (value.schema !== 'rho.semantic-figure/1') throw new Error('Unsupported figure format.');
  return { dir, value, digest: sha(bytes) };
}
async function selection(root, id, digest) {
  try {
    const state = JSON.parse(await readBounded(await contained(root, `${base}/${id}/selection.json`), 32768));
    if (state.digest !== digest) throw new Error('Selection belongs to another figure version.');
    return state;
  } catch (e) { if (e.code !== 'ENOENT') throw e; return { revision: 0, digest, keys: [] }; }
}

export async function run(operation, input, ctx) {
  if (operation === 'cell') return ctx.call('kernel.read', { cellId: input.cellId });
  if (operation === 'list') {
    let dir;
    try { dir = await directory(ctx.projectRoot); } catch (e) { if (e.code === 'ENOENT') return { figures: [] }; throw e; }
    const names = (await fs.readdir(dir)).filter(name => idPattern.test(name));
    if (names.length > limits.figures) throw new Error(`Figure count exceeds ${limits.figures}; move older figure folders out of ${base} before listing.`);
    const figures = [];
    for (const id of names) {
      try { const f = await figure(ctx.projectRoot, id); figures.push({ id, title: f.value.title, adapter: f.value.adapter, createdAt: f.value.createdAt }); }
      catch (e) { figures.push({ id, title: id, unavailable: e.code === 'ENOENT' ? 'Capture has not produced a figure. Observe its original Notebook cell.' : e.message }); }
    }
    return { figures: figures.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')) };
  }
  if (operation === 'capture') {
    if (!['ggtree', 'enrichplot'].includes(input.adapter)) throw new Error('Unknown figure adapter.');
    const sessions = await ctx.call('kernel.read', { limit: 1 });
    if (sessions.sessions.some(s => s.language === 'r' && s.state !== 'ended' && s.place)) throw new Error('This first adapter requires a local R session. Remote capture is not supported.');
    const source = await contained(ctx.projectRoot, input.source);
    const sourceBytes = await readBounded(source, limits.sourceBytes);
    const dir = await directory(ctx.projectRoot, true);
    if ((await fs.readdir(dir)).filter(name => idPattern.test(name)).length >= limits.figures) throw new Error(`The ${limits.figures}-figure limit is reached. Existing figures are retained.`);
    const id = sha(ctx.invocationId).slice(0, 32), output = path.join(dir, id);
    await fs.mkdir(output); // A capture is immutable; do not overwrite earlier output.
    await fs.writeFile(path.join(output, 'source.rds'), sourceBytes, { flag: 'wx' });
    const script = fileURLToPath(new URL('./capture.R', import.meta.url));
    const code = `local({\nsource(${quote(script)}, local=TRUE)\nrho_capture(${quote(input.adapter)}, ${quote(path.join(output, 'source.rds'))}, ${quote(output)}, ${quote(input.title || path.basename(input.source))}, ${quote(input.source)}, ${quote(sha(sourceBytes))}, ${input.showCategory ?? 5}L, ${quote(path.join(path.dirname(script), 'adapters'))})\n})`;
    const result = await ctx.call('kernel.run', { language: 'r', code, purpose: `Capture ${input.adapter} figure with semantic selections`, waitMs: 0, changeId: ctx.changeId('capture') });
    return { id, ...result };
  }
  const f = await figure(ctx.projectRoot, input.id);
  if (operation === 'read') {
    let sourceState = 'unchanged';
    try { sourceState = sha(await readBounded(await contained(ctx.projectRoot, f.value.source.path), limits.sourceBytes)) === f.value.source.sha256 ? 'unchanged' : 'changed'; }
    catch { sourceState = 'unavailable'; }
    return { id: input.id, digest: f.digest, figure: f.value, sourceState, selection: await selection(ctx.projectRoot, input.id, f.digest) };
  }
  if (input.expectedDigest !== f.digest) throw new Error('Figure version changed. Reload it before selecting.');
  if (operation === 'selection') {
    const state = await selection(ctx.projectRoot, input.id, f.digest);
    return { ...state, source: f.value.source, adapter: f.value.adapter, entities: state.keys.map(key => f.value.entities.find(e => e.key === key)) };
  }
  if (operation !== 'select') throw new Error('Unknown figure operation.');
  const keys = [...new Set(input.keys)];
  if (keys.length > limits.selectionKeys || keys.some(key => !f.value.entities.some(e => e.key === key))) throw new Error('Selection contains an unknown entity or exceeds its limit.');
  const lockPath = path.join(f.dir, 'selection.lock');
  let lock;
  try { lock = await fs.open(lockPath, 'wx'); } catch (e) { if (e.code === 'EEXIST') throw new Error('Another selection is being saved. Reload and try again.'); throw e; }
  try {
    const previous = await selection(ctx.projectRoot, input.id, f.digest);
    if (input.expectedRevision !== previous.revision) throw new Error('Selection changed in another view. Reload before changing it.');
    const state = { revision: previous.revision + 1, digest: f.digest, keys, at: new Date().toISOString() };
    const temp = path.join(f.dir, `selection-${sha(ctx.invocationId).slice(0, 16)}.tmp`);
    await fs.writeFile(temp, JSON.stringify(state), { flag: 'wx' });
    await fs.rename(temp, path.join(f.dir, 'selection.json'));
    return state;
  } finally { await lock.close(); await fs.unlink(lockPath); }
}
