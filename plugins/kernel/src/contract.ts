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
});
