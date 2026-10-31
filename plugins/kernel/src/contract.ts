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

export const placeIdPattern = '^(?!local$)[a-z][a-z0-9-]{0,31}$';
// An ssh destination as ssh takes it: a Host from the person's config, user@host or
// ssh://user@host:port. It never starts with "-", so it cannot be read as an option.
export const destinationPattern = '^[A-Za-z0-9_.%+@:\\[\\]/][A-Za-z0-9_.%+@:\\[\\]/-]{0,254}$';
// The folder on the server: an absolute path, or one in the account's home (~/...).
export const folderPattern = '^(~|~/[^\\n\\u0000]*|/[^\\n\\u0000]*)$';
// A server's name in serverctl, spelled as serverctl allows its aliases.
export const serverPattern = '^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$';
// How a place's server is reached: with ssh, as the person's ssh setup reaches it, or through
// serverctl, which holds the login of a server the person manages with it.
export const vias = ['ssh', 'serverctl'] as const;

// Where sessions run: this machine ("local") or a named place, a folder on a server reached as the
// person reaches it.
export const placeId = { type: 'string', pattern: placeIdPattern };
export const server = { type: 'string', pattern: serverPattern };
export const placeRef = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,31}$' };
const destination = { type: 'string', pattern: destinationPattern }, folder = { type: 'string', pattern: folderPattern, maxLength: 1024 };
// What one connection to the place observed, and when; null where it was not seen.
export const placeCheckSchema = obj({
  at: time, by: text, ok: { type: 'boolean' }, ms: { type: 'integer', minimum: 0 }, system: maybe({ type: 'string' }), host: maybe({ type: 'string' }), folder: maybe({ type: 'string' }),
  r: maybe({ type: 'string' }), jsonlite: maybe({ type: 'boolean' }), python: maybe({ type: 'string' }), matplotlib: maybe({ type: 'boolean' }), problem: maybe({ type: 'string' }),
});
// setup: shell lines run in the folder before a session starts there (module load, conda activate).
// via serverctl: destination is the server's name there. A place named without via is reached
// through serverctl when serverctl manages a server of that name, and with ssh otherwise.
export const placeSchema = obj({ placeId, label: text, via: { enum: [...vias] }, destination, folder, setup: { type: 'string', maxLength: 4096 }, by: text, at: time, check: maybe(placeCheckSchema) });
export const placeInput = obj({ placeId, label: { type: 'string', maxLength: 80 }, via: { enum: [...vias] }, destination, folder, setup: { type: 'string', maxLength: 4096 } }, ['placeId', 'destination', 'folder']);
// A file copied from a place into the project, with the size, time and digest it had there.
export const copySchema = obj({ placeId, path: text, to: text, bytes: { type: 'integer', minimum: 0 }, modifiedAt: maybe(time), sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' }, copiedAt: time, by: text });
export const placesSchema = obj({ places: { type: 'array', items: placeSchema }, use: obj({ r: placeRef, python: placeRef }), copies: { type: 'array', items: copySchema } });
// The servers the person manages with serverctl, as its registry has them, and the skills bound
// to each: what working on that server takes, written for whoever works there. status is
// serverctl's (ready, missing, invalid, name_mismatch); problem says why one is not ready.
export const serverSkillSchema = obj({ name: text, description: { type: 'string' }, path: text, status: text, problem: maybe({ type: 'string' }) });
export const serversSchema = obj({
  tool: obj({ program: text, ok: { type: 'boolean' }, problem: maybe({ type: 'string' }) }),
  servers: { type: 'array', items: obj({ server, system: maybe({ type: 'string' }), tags: { type: 'array', items: { type: 'string' } }, skills: { type: 'array', items: serverSkillSchema } }) },
  readAt: time,
});
export const serverSkillTextSchema = obj({ server, name: text, description: { type: 'string' }, path: text, text: { type: 'string' }, bytes: { type: 'integer', minimum: 0 }, readAt: time });
export const remoteEntrySchema = obj({ name: text, kind: { enum: ['folder', 'file', 'link', 'other'] }, bytes: { type: 'number', minimum: 0 }, modifiedAt: maybe(time) });
// The session's place as it was named when the session started, with the folder it ran in.
const sessionPlaceSchema = obj({ placeId, label: text, destination, folder: text });

export const sessionSchema = obj({
  sessionId, language, state: { enum: [...sessionStates] }, version: maybe({ type: 'string' }), pid: maybe({ type: 'integer' }),
  startedAt: time, startedBy: text, endedAt: maybe(time),
  // Why it ended: stopped by someone, its process exited, the connection to its server was lost
  // (its process there was not seen to end), or Rho closed while it ran.
  ending: maybe({ enum: ['stopped', 'exited', 'disconnected', 'rho-closed', 'not-started'] }), stop: maybe(askedSchema), problem: maybe({ type: 'string' }),
  // The session's variables after its last cell, as the session listed them.
  variables: { type: 'array', items: variableSchema }, variablesOmitted: { type: 'integer', minimum: 0 }, variablesAt: maybe(time),
  cells: { type: 'integer', minimum: 0 },
  // Where it ran (null: this machine) and the machine's own name. Sessions recorded before have neither.
  place: maybe(sessionPlaceSchema), host: maybe({ type: 'string' }),
}, ['sessionId', 'language', 'state', 'version', 'pid', 'startedAt', 'startedBy', 'endedAt', 'ending', 'stop', 'problem', 'variables', 'variablesOmitted', 'variablesAt', 'cells']);
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
