import fs from 'node:fs/promises';
import path from 'node:path';

// What models.dev lists about a model: whether it takes images and its price per million
// tokens. The catalog is fetched with a plain GET, kept in a file the caller names, and read
// again once a day. The protected resources are the network and the caller's disk: one
// download of at most `maxBytes`, within `timeoutMs`, no more often than `retryMs` after a
// failure. Without a catalog a model is not known, and nothing else changes.
export const modelCatalogLimits = { url: 'https://models.dev/api.json', maxBytes: 16 * 1024 * 1024, timeoutMs: 20000, refreshMs: 24 * 3600 * 1000, retryMs: 10 * 60 * 1000 };

// US dollars per million tokens.
export interface Price { input: number; output: number; cacheRead?: number; cacheWrite?: number }
export interface CatalogModel { provider: string; id: string; canonical: string | null; name: string; input: string[]; price: Price | null }
export interface ModelCatalog { format: 1; fetchedAt: string; source: string; models: CatalogModel[] }
// A session's model as models.dev lists it. `basis` says which listing was used: the provider
// the session names, the model's own maker, or every provider that lists it (the price is
// then their median and `images` what most of them say).
export interface ModelFacts { model: string; listed: string; images: boolean; price: Price | null; basis: 'provider' | 'origin' | 'median'; providers: number; fetchedAt: string }

const failed = new Map<string, number>();
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;

// models.dev's api.json: providers, each with its models.
export function compactCatalog(raw: unknown, fetchedAt: string, source = modelCatalogLimits.url): ModelCatalog {
  const models: CatalogModel[] = [];
  if (raw && typeof raw === 'object') for (const [provider, entry] of Object.entries(raw as Record<string, any>)) {
    for (const [id, m] of Object.entries((entry?.models ?? {}) as Record<string, any>)) {
      if (!m || typeof m !== 'object') continue;
      const cost = m.cost ?? {}, input = number(cost.input), output = number(cost.output);
      models.push({ provider, id: String(m.id ?? id), canonical: typeof m.canonical_model_id === 'string' ? m.canonical_model_id : null, name: String(m.name ?? id),
        input: Array.isArray(m.modalities?.input) ? m.modalities.input.filter((x: unknown) => typeof x === 'string') : [],
        price: input !== undefined && output !== undefined ? { input, output, ...(number(cost.cache_read) !== undefined ? { cacheRead: number(cost.cache_read) } : {}), ...(number(cost.cache_write) !== undefined ? { cacheWrite: number(cost.cache_write) } : {}) } : null });
    }
  }
  return { format: 1, fetchedAt, source, models };
}

// The catalog from `file` while it is fresh, else from models.dev. A failed download keeps the
// last catalog and says so; it is not tried again for `retryMs`.
export async function loadModelCatalog(file: string, options: { fetch?: typeof fetch; now?: () => number; limits?: Partial<typeof modelCatalogLimits> } = {}): Promise<{ catalog: ModelCatalog | null; stale: boolean; problem?: string }> {
  const limits = { ...modelCatalogLimits, ...options.limits }, now = options.now ?? Date.now;
  let cached: ModelCatalog | null = null;
  try { const value = JSON.parse(await fs.readFile(file, 'utf8')); if (value?.format === 1 && Array.isArray(value.models)) cached = value; } catch { /* none yet */ }
  if (cached && now() - Date.parse(cached.fetchedAt) < limits.refreshMs) return { catalog: cached, stale: false };
  const last = failed.get(file);
  if (last !== undefined && now() - last < limits.retryMs) return { catalog: cached, stale: !!cached, problem: 'models.dev could not be read recently; it is not asked again yet.' };
  try {
    const response = await (options.fetch ?? fetch)(limits.url, { signal: AbortSignal.timeout(limits.timeoutMs), headers: { accept: 'application/json' } });
    if (!response.ok || !response.body) throw new Error(`models.dev answered ${response.status}.`);
    const reader = response.body.getReader(), parts: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limits.maxBytes) { await reader.cancel(); throw new Error('The models.dev catalog is larger than maxBytes.'); }
      parts.push(value);
    }
    const catalog = compactCatalog(JSON.parse(Buffer.concat(parts).toString('utf8')), new Date(now()).toISOString(), limits.url);
    if (!catalog.models.length) throw new Error('The models.dev catalog listed no models.');
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = file + '.' + process.pid + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(catalog)); await fs.rename(temporary, file);
    failed.delete(file);
    return { catalog, stale: false };
  } catch (error) {
    failed.set(file, now());
    return { catalog: cached, stale: !!cached, problem: 'models.dev could not be read: ' + (error instanceof Error ? error.message : String(error)) };
  }
}

const tailOf = (id: string) => id.toLowerCase().split('/').at(-1)!;
const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
// A session's model, such as "gateway/deepseek-v4.1-flash[1m]" or "claude-opus-5-5", as
// models.dev lists it. Context-size marks are dropped; a leading provider is used when
// models.dev knows it, and otherwise the name is matched across every provider.
export function findModel(catalog: ModelCatalog, model: string): ModelFacts | null {
  const name = model.toLowerCase().replace(/\[[^\]]*\]$/, '').trim(), tail = tailOf(name), hint = name.includes('/') ? name.slice(0, name.lastIndexOf('/')).split('/').at(-1)! : null;
  if (!tail) return null;
  const facts = (m: CatalogModel, basis: ModelFacts['basis'], providers: number): ModelFacts => ({ model, listed: m.provider + '/' + m.id, images: m.input.includes('image'), price: m.price, basis, providers, fetchedAt: catalog.fetchedAt });
  const named = hint ? catalog.models.find(m => m.provider === hint && (m.id.toLowerCase() === name.slice(hint.length + 1) || tailOf(m.id) === tail)) : undefined;
  if (named) return facts(named, 'provider', 1);
  const matches = catalog.models.filter(m => tailOf(m.id) === tail || (m.canonical && tailOf(m.canonical) === tail));
  if (!matches.length) return null;
  // The model's own maker, as its canonical id names it, when models.dev lists it there.
  const canonical = matches.map(m => m.canonical).find(c => c && tailOf(c) === tail) ?? null;
  const origin = canonical ? matches.find(m => m.provider === canonical.split('/')[0] && (m.canonical === canonical || tailOf(m.id) === tail)) : undefined;
  if (origin) return facts(origin, 'origin', matches.length);
  const priced = matches.filter(m => m.price && m.price.input > 0 && m.price.output > 0).map(m => m.price!);
  const price: Price | null = priced.length ? { input: median(priced.map(p => p.input)), output: median(priced.map(p => p.output)),
    ...(priced.some(p => p.cacheRead !== undefined) ? { cacheRead: median(priced.filter(p => p.cacheRead !== undefined).map(p => p.cacheRead!)) } : {}),
    ...(priced.some(p => p.cacheWrite !== undefined) ? { cacheWrite: median(priced.filter(p => p.cacheWrite !== undefined).map(p => p.cacheWrite!)) } : {}) } : null;
  const images = matches.filter(m => m.input.includes('image')).length * 2 > matches.length;
  return { model, listed: canonical ?? tail, images, price, basis: 'median', providers: matches.length, fetchedAt: catalog.fetchedAt };
}

export interface Tokens { input: number; output: number; cacheRead: number; cacheWrite: number }
// What one call cost: Claude Code's own figure when it knows the model's list price, else an
// estimate from the tokens it reports and the price models.dev lists, else unknown with
// Claude Code's guess named. A provider's bill may differ from either.
export interface CallCost { usd: number | null; basis: 'reported' | 'estimated' | 'unknown'; note: string }
export function callCost(call: { costUsd: number | null; costBasis: string | null; tokens: Tokens | null }, facts: ModelFacts | null): CallCost {
  if (call.costUsd !== null && call.costBasis && call.costBasis !== 'unknown') return { usd: call.costUsd, basis: 'reported', note: 'Claude Code\'s ' + call.costBasis + ' price' };
  if (facts?.price && call.tokens) {
    const p = facts.price, t = call.tokens;
    const usd = (t.input * p.input + t.output * p.output + t.cacheRead * (p.cacheRead ?? p.input) + t.cacheWrite * (p.cacheWrite ?? p.input)) / 1e6;
    return { usd, basis: 'estimated', note: facts.basis === 'median' ? `models.dev's median price for ${facts.listed} across ${facts.providers} providers` : `models.dev's price for ${facts.listed}` };
  }
  return { usd: null, basis: 'unknown', note: call.costUsd !== null ? `Claude Code did not know this model's price and guessed $${call.costUsd.toFixed(4)}` : 'No price was reported or listed' };
}
