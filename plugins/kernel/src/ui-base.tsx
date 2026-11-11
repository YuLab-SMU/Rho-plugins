// What the Notebook and the views beside it share: the calls they make, the facts they read from
// the page that shows them, and the few services that page can offer. Each service is optional:
// code stays plain without highlighting, and a skill's text shows as written without Markdown.
import { createContext, useContext, type ReactNode } from 'react';
import type { KernelHost } from './index.js';

export interface UiClient { call(method: string, input: any, signal?: AbortSignal): Promise<any> }
type Out<K extends keyof KernelHost> = KernelHost[K] extends (...args: any[]) => infer R ? Awaited<R> : never;
// What each operation the views call returns, as the session host returns it.
export interface KernelOutputs {
  'kernel.run': Out<'run'>; 'kernel.read': Out<'read'>; 'kernel.inspect': Inspected; 'kernel.plot': Out<'plot'>;
  'kernel.interrupt': Out<'interrupt'>; 'kernel.start': Out<'start'>; 'kernel.stop': Out<'stop'>; 'kernel.places': Out<'places'>; 'kernel.place.set': Out<'setPlace'>;
  'kernel.place.check': Out<'check'>; 'kernel.place.list': Out<'list'>; 'kernel.place.copy': Out<'copy'>;
  'kernel.servers': Out<'servers'>; 'kernel.server.skill': Out<'serverSkill'>;
}
// One value as the session describes it (objectSchema in contract.ts): its kind, size and facts,
// and the part of it asked for: a table's page of rows, a list's children, a vector's values.
export interface Inspected {
  state: 'shown' | 'busy' | 'none' | 'missing' | 'timeout' | 'failed' | 'ended';
  // runningCell: the cell that ran while the value was read from the session's copy, as it was when that cell started.
  sessionId: string | null; afterCell: number; runningCell?: number | null; readAt: string; problem: string | null;
  object: {
    name: string; expression: string; kind: 'table' | 'model' | 'vector' | 'list' | 'function' | 'value' | 'other';
    type: string; size: string; bytes: number; facts: { label: string; value: string }[]; trail: { index: number; name: string }[];
    picture?: { data: string; width: number; height: number }; pictureProblem?: string;
    children?: { items: { expression: string; index: number; name: string; size: string; summary: string; type: string }[]; offset: number; total: number };
    table?: {
      columns: { missing: number; name: string; numeric: boolean; summary: string; type: string; values: string[] }[];
      columnsTotal: number; offset: number; rowLabels: string[]; rows: number;
      sort?: { column: number; descending: boolean } | null; sortRefused?: string | null;
    };
    text?: { cut: boolean; label: string; text: string };
    values?: { items: { name: string | null; value: string }[]; offset: number; total: number };
  } | null;
}
export const call = <M extends keyof KernelOutputs>(client: UiClient, method: M, input: object, signal?: AbortSignal) => client.call(method, input, signal) as Promise<KernelOutputs[M]>;
// The sessions are off for this project, or this page may not use them.
export const refused = (error: unknown) => ['unavailable', 'unauthorized'].includes((error as { error?: { kind?: string } } | null)?.error?.kind ?? '');

// The facts of the page these views read: the project, the page's place in its event stream, and
// the conversations whose Agents ran cells, so a cell can name who ran it.
export interface UiSnapshot {
  project: { id: string; root: string };
  cursor: number;
  conversations?: ReadonlyArray<{ conversationId: string; principal?: string | null; client?: string | null; title?: string | null }>;
  // The Agents with access: one the person connected from its own window has no conversation
  // here, and is named as the page names it, else by the label it was given.
  agents?: ReadonlyArray<{ principal: string; label?: string | null; name?: string | null; conversationId?: string | null }>;
}
// Who ran a cell, by principal: a conversation's Agent, or an Agent the person connected. Where
// a session was started is not part of the name.
export function agentNames(snapshot: UiSnapshot) {
  const names = new Map<string, string>();
  for (const a of snapshot.agents ?? []) { const name = a.name ?? a.label; if (name) names.set(a.principal, name); }
  for (const c of snapshot.conversations ?? []) if (c.principal) names.set(c.principal, agentName(c.client));
  return names;
}
// One conversation's share of the sessions, as its Studio shows them: the cells its Agent and the
// person ran since it began, up to `at` during a replay (null for now).
export type { SessionScope } from './session-scope.js';

// A plot whose marks an extension bound to their rows, as the page that shows the Notebook draws
// it: the page owns how it is drawn and what asking about it does; the picture stands in for it.
// It is a plot a cell drew (cellId, plot), or a file a cell saved one as (file).
export interface FigureSlot {
  client: UiClient; projectId: string; cellId?: string; plot?: number; file?: { path?: string; sha256: string }; width?: number; height?: number; label: string;
  // A short name for the plot where it is mentioned elsewhere: "R cell 4, plot 1".
  name?: string; fit?: boolean; cursor?: number; fallback: ReactNode; author?: (by: string) => { name: string; mine: boolean };
}
export interface KernelShell {
  highlight?(code: string, language: string): Promise<DocumentFragment | null>;
  openPath?(path: string): void;
  markdown?(text: string): ReactNode;
  figure?(slot: FigureSlot): ReactNode;
  // A project image file as a URL this page can show, or null when it cannot be read.
  imageUrl?(path: string): Promise<string | null>;
}
const Shell = createContext<KernelShell>({});
export const ShellProvider = Shell.Provider;
export const useShell = () => useContext(Shell);
export const withShell = (shell: KernelShell | undefined, node: ReactNode) => shell ? <ShellProvider value={shell}>{node}</ShellProvider> : node;

// A session run by a program in the project is named by its environment's folder (.venv); one
// run by a program elsewhere is named by its version alone.
type Session = KernelOutputs['kernel.read']['sessions'][number];
export const environmentOf = (session: Pick<Session, 'program'>) => {
  const program = session.program;
  if (!program || /^([A-Za-z]:)?[\\/]/.test(program)) return null;
  return program.match(/^(.+?)[\\/](?:bin|Scripts)[\\/][^\\/]+$/)?.[1] ?? program;
};
export const versionOf = (session: Pick<Session, 'program' | 'version' | 'language'>) => {
  const version = session.version?.replace(/^R version (\S+).*$/, 'R $1') ?? (session.language === 'r' ? 'R' : 'Python'), environment = environmentOf(session);
  return environment ? version + ' · ' + environment : version;
};

export const clock = (ms: number, seconds = false) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hourCycle: 'h23' });
export function durationText(ms: number) {
  if (ms < 10_000) return (Math.max(ms, 100) / 1000).toFixed(1) + ' s';
  if (ms < 60_000) return Math.round(ms / 1000) + ' s';
  const minutes = Math.floor(ms / 60_000), seconds = Math.round((ms % 60_000) / 1000);
  return minutes + ' min' + (seconds ? ' ' + seconds + ' s' : '');
}
export const agentName = (client?: string | null) => client === 'codex' ? 'Codex' : client === 'claude-code' ? 'Claude Code' : 'Agent';
export function when(iso: string, now = new Date()) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return { text: '', full: '' };
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86400000);
  const text = days === 0 ? 'Today at ' + at.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : days === 1 ? 'Yesterday'
    : at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
  return { text, full: at.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' }) };
}
