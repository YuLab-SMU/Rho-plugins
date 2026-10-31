import { objectSchema as obj, text } from '@rho-workspace/plugin-contracts';

// A live session and the cells run in it, as this process observed them. How a cell ended is
// what the session reported: its output, an error, an interrupt, or unknown when Rho was not
// there to see the end. Nothing here says what a result means or whether it is right.
export const languages = ['r', 'python'] as const;
export const changeId = { type: 'string', pattern: '^[A-Za-z0-9._:@-]{1,128}$' };
export const cellId = { type: 'string', pattern: '^k-[a-f0-9]{16}$' };
export const sessionId = { type: 'string', pattern: '^s-[a-f0-9]{16}$' };
export const language = { enum: [...languages] };
const time = { type: 'string', minLength: 1 };
const maybe = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
// Who asked for an interrupt or a stop, and when.
export const askedSchema = obj({ by: text, at: time });
export const sessionStates = ['starting', 'idle', 'busy', 'ended'] as const;
export const cellStates = ['queued', 'running', 'done', 'error', 'interrupted', 'not-run', 'unknown'] as const;
export const variableSchema = obj({ name: text, type: { type: 'string' }, size: { type: 'string' }, bytes: { type: 'number', minimum: 0 }, summary: { type: 'string' } });
export const sessionSchema = obj({
  sessionId, language, state: { enum: [...sessionStates] }, version: maybe({ type: 'string' }), pid: maybe({ type: 'integer' }),
  startedAt: time, startedBy: text, endedAt: maybe(time),
  // Why it ended: stopped by someone, its process exited, or Rho closed while it ran.
  ending: maybe({ enum: ['stopped', 'exited', 'rho-closed', 'not-started'] }), stop: maybe(askedSchema), problem: maybe({ type: 'string' }),
  // The session's variables after its last cell, as the session listed them.
  variables: { type: 'array', items: variableSchema }, variablesOmitted: { type: 'integer', minimum: 0 }, variablesAt: maybe(time),
  cells: { type: 'integer', minimum: 0 },
});
export const outputSchema = obj({ kind: { enum: ['stdout', 'stderr', 'warning', 'error', 'plot'] }, text: { type: 'string' }, plot: { type: 'integer', minimum: 1 }, width: { type: 'integer' }, height: { type: 'integer' } }, ['kind']);
export const cellSchema = obj({
  cellId, changeId, by: text, sessionId, language, code: { type: 'string' }, purpose: maybe({ type: 'string' }),
  queuedAt: time, startedAt: maybe(time), endedAt: maybe(time), state: { enum: [...cellStates] },
  // The order it ran in its session, counting from 1.
  number: { type: 'integer', minimum: 1 },
  outputs: { type: 'array', items: outputSchema },
  // Bytes the cell printed, bytes kept, and whether some past the kept size were left out.
  bytes: { type: 'integer', minimum: 0 }, kept: { type: 'integer', minimum: 0 }, cut: { type: 'boolean' },
  interrupt: maybe(askedSchema), problem: maybe({ type: 'string' }),
  // The variables the session listed differently after the cell (new, or another type, size or
  // summary) or that its code assigned to, and those it no longer listed. Cells recorded before
  // this was kept have neither.
  defined: { type: 'array', items: text }, removed: { type: 'array', items: text },
  // The session's values the code read (names it mentions that the session held before it), and
  // the project files and folders (ending in /) its strings name, as read or written. Cells
  // recorded before have neither.
  used: { type: 'array', items: text }, files: { type: 'array', items: obj({ path: text, how: { enum: ['read', 'wrote'] } }) },
}, ['cellId', 'changeId', 'by', 'sessionId', 'language', 'code', 'purpose', 'queuedAt', 'startedAt', 'endedAt', 'state', 'number', 'outputs', 'bytes', 'kept', 'cut', 'interrupt', 'problem']);

// One value of a live session as its session describes it: the kind of thing it is, short facts,
// and one page of its rows, its elements or its parts, each part with the code that reaches it.
// Pages and texts are cut at the plugin's limits and say how many there are in all.
export const objectKinds = ['table', 'model', 'vector', 'list', 'function', 'value', 'other'] as const;
const count = { type: 'integer', minimum: 0 };
const strings = { type: 'array', items: { type: 'string' } };
const columnSchema = obj({ name: { type: 'string' }, type: { type: 'string' }, numeric: { type: 'boolean' }, missing: count, summary: { type: 'string' }, values: strings });
const sortSchema = obj({ column: count, descending: { type: 'boolean' } });
const tableSchema = obj({ rows: count, columnsTotal: count, offset: count, rowLabels: strings, columns: { type: 'array', items: columnSchema }, sort: maybe(sortSchema), sortRefused: maybe({ type: 'string' }) }, ['rows', 'columnsTotal', 'offset', 'rowLabels', 'columns']);
const valuesSchema = obj({ total: count, offset: count, items: { type: 'array', items: obj({ name: maybe({ type: 'string' }), value: { type: 'string' } }) } });
const childSchema = obj({ index: count, name: { type: 'string' }, type: { type: 'string' }, size: { type: 'string' }, summary: { type: 'string' }, expression: { type: 'string' } });
export const objectSchema = obj({
  name: text, expression: text, trail: { type: 'array', items: obj({ index: count, name: { type: 'string' } }) },
  kind: { enum: [...objectKinds] }, type: { type: 'string' }, size: { type: 'string' }, bytes: { type: 'number', minimum: 0 },
  facts: { type: 'array', items: obj({ label: { type: 'string' }, value: { type: 'string' } }) },
  table: tableSchema, values: valuesSchema, children: obj({ total: count, offset: count, items: { type: 'array', items: childSchema } }),
  text: obj({ label: { type: 'string' }, text: { type: 'string' }, cut: { type: 'boolean' } }),
}, ['name', 'expression', 'trail', 'kind', 'type', 'size', 'bytes', 'facts']);
// shown: described; busy: a cell is running or waiting; none: no live session of that language;
// missing: no such value or part; timeout: reading it took too long and was stopped; failed: the
// session could not describe it; ended: the session ended while it was read.
export const inspectStates = ['shown', 'busy', 'none', 'missing', 'timeout', 'failed', 'ended'] as const;
export const sortInput = sortSchema;
