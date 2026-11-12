import { objectSchema as obj, text } from '@rho-workspace/plugin-contracts';

// A command a person ran in a project folder, as the console observed it. How it ended is what
// this process saw: an exit code or signal, a stop it was asked for, or unknown when Rho was not
// there to see the end. Nothing here says what the command meant or whether its output is right.
export const changeId = { type: 'string', pattern: '^[A-Za-z0-9._:@-]{1,128}$' };
export const commandId = { type: 'string', pattern: '^c-[a-f0-9]{16}$' };
const time = { type: 'string', minLength: 1 };
export const commandStates = ['running', 'exited', 'stopped', 'not-started', 'continuing', 'unknown'] as const;
export const recordSchema = obj({
  commandId, changeId, command: text, cwd: { type: 'string' }, by: text,
  startedAt: time, endedAt: { anyOf: [time, { type: 'null' }] },
  state: { enum: [...commandStates] },
  exit: { anyOf: [obj({ code: { anyOf: [{ type: 'integer' }, { type: 'null' }] }, signal: { anyOf: [{ type: 'string' }, { type: 'null' }] } }), { type: 'null' }] },
  pid: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
  // Bytes the command printed, bytes kept, and whether some in between were not kept.
  bytes: { type: 'integer', minimum: 0 }, kept: { type: 'integer', minimum: 0 }, cut: { type: 'boolean' },
  stop: { anyOf: [obj({ requestedAt: time, by: text }), { type: 'null' }] },
  problem: { anyOf: [{ type: 'string' }, { type: 'null' }] },
});

// A terminal: a shell on a pseudo-terminal, for as long as Rho runs, opened by `by`. `bytes` is
// what it has printed so far and `kept` the offset of the oldest byte a read can still return.
// `typedBy` is the latest input from anyone other than whoever opened it.
export const terminalId = { type: 'string', pattern: '^t-[a-f0-9]{16}$' };
export const terminalSize = { cols: { type: 'integer', minimum: 2, maximum: 500 }, rows: { type: 'integer', minimum: 1, maximum: 300 } };
export const terminalSchema = obj({
  terminalId, by: text, shell: text, cwd: { type: 'string' }, ...terminalSize,
  startedAt: time, endedAt: { anyOf: [time, { type: 'null' }] },
  exit: { anyOf: [obj({ code: { anyOf: [{ type: 'integer' }, { type: 'null' }] }, signal: { anyOf: [{ type: 'string' }, { type: 'null' }] } }), { type: 'null' }] },
  bytes: { type: 'integer', minimum: 0 }, kept: { type: 'integer', minimum: 0 },
  problem: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  typedBy: { anyOf: [obj({ by: text, at: time }), { type: 'null' }] },
  recording: { type: 'boolean' },
}, ['terminalId', 'by', 'shell', 'cwd', 'cols', 'rows', 'startedAt', 'endedAt', 'exit', 'bytes', 'kept', 'problem']);

// A command run in a terminal, as its shell marked it: who typed it (the first first), the folder
// it ran in, how it ended and the start of what it printed. `unknown` is an end that was not seen.
export const terminalCommandSchema = obj({
  commandId: { type: 'string', pattern: '^tc-[a-f0-9]{16}$' }, terminalId, command: { type: 'string' }, cwd: { type: 'string' },
  by: { type: 'array', items: text, minItems: 1 }, startedAt: time, endedAt: { anyOf: [time, { type: 'null' }] },
  state: { enum: ['running', 'exited', 'unknown'] }, exit: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
  output: { type: 'string' }, cut: { type: 'boolean' }, problem: { anyOf: [{ type: 'string' }, { type: 'null' }] },
});
