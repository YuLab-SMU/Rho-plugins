// A conversation an Agent holds in its own record: a retained observation of another client's
// conversation, or a session the Agent keeps in its own files. Reading it starts nothing.
const text = { type: 'string' }, count = { type: 'integer', minimum: 0 };
const obj = (properties: Record<string, any>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const array = (items: object, maxItems: number) => ({ type: 'array', items, maxItems });
export const externalSessionLimits = { maxSessions: 64, maxTurns: 200, maxTools: 256, maxRecordBytes: 4194304, maxEvents: 32768, maxSourceBytes: 33554432, maxTextChars: 32768, maxDetailChars: 8192 };
const state = { enum: ['running', 'completed', 'failed', 'stopped', 'unknown'] };
export const externalResultSchema = obj({ path: text, id: text, version: text, projectId: text, toolId: text }, ['path', 'toolId']);
export const externalToolSchema = obj({ id: text, at: text, name: text, detail: text, output: text, outcome: { enum: ['requested', 'returned', 'failed', 'unknown'] }, exitCode: { type: 'integer' }, paths: array(text, 32) }, ['id', 'at', 'name', 'detail', 'output', 'outcome', 'paths']);
export const externalTurnSchema = obj({ id: text, at: text, endedAt: text, state, prompt: text, reply: text, messages: array(obj({ at: text, text }), 200), tools: array(externalToolSchema, externalSessionLimits.maxTools), results: array(externalResultSchema, 64), omittedTools: count, omittedChars: count, where: text }, ['id', 'at', 'state', 'prompt', 'reply', 'messages', 'tools', 'results', 'omittedTools', 'omittedChars']);
export const externalSessionSummarySchema = obj({ id: { type: 'string', pattern: '^x-[a-f0-9]{64}$' }, producer: text, sessionId: text, title: text, lastAt: text, observedAt: text, state, turns: count, sourceCursor: count, omittedTurns: count, problem: text, inputOwner: { const: 'external' },
  // Native sessions: where it was started, a live process holding it, the command that continues it in a terminal
  // and its size. The application adds the Agent it continues with in Rho (acp:… is an ACP Agent the person
  // added there) and the Rho conversation that continued it.
  where: text, open: { anyOf: [{ type: 'null' }, obj({ where: text, since: text, pid: count }, ['where'])] }, resume: text, bytes: count,
  continueWith: { anyOf: [{ enum: ['claude-acp', 'codex-acp', 'acp', null] }, { type: 'string', pattern: '^acp:[a-z0-9][a-z0-9-]{0,39}$' }] }, conversationId: text }, ['id', 'producer', 'sessionId', 'title', 'lastAt', 'observedAt', 'state', 'turns', 'sourceCursor', 'omittedTurns']);
export const externalSessionSchemas = { summary: externalSessionSummarySchema, turn: externalTurnSchema };
export const externalSessionOperations = {
  'agent.sessions.list': { inputSchema: obj({}), outputSchema: obj({ sessions: array(externalSessionSummarySchema, 128), omitted: count }), requires: [], effect: 'read' as const },
  'agent.sessions.read': { inputSchema: obj({ session: { type: 'string', pattern: '^x-[a-f0-9]{64}$' }, before: count, limit: { type: 'integer', minimum: 1, maximum: 50 } }, ['session']), outputSchema: obj({ session: externalSessionSummarySchema, first: count, turns: array(externalTurnSchema, 50) }), requires: [], effect: 'read' as const },
};
