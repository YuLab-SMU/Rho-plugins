import { objectSchema as obj, text } from '@rho-workspace/plugin-contracts';

// Owner business contracts. Application project/authentication fields are separate.
// A figure is named by the Notebook cell that drew it and the plot's number in that cell. A mark
// is "L.M": layer L of the figure, built row M of that layer, both counted from 0.
const cellId = { type: 'string', pattern: '^k-[a-f0-9]{16}$' };
const plot = { type: 'integer', minimum: 1, maximum: 64 };
const mark = { type: 'string', pattern: '^\\d{1,4}\\.\\d{1,7}$' };
export const selectionId = { type: 'string', pattern: '^f-[a-f0-9]{16}$' };
const changeId = { type: 'string', pattern: '^[A-Za-z0-9._:@-]{1,128}$' };
const cell = { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] };
const where = obj({ column: { type: 'string', minLength: 1, maxLength: 256 }, op: { enum: ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'in', 'contains'] }, value: { anyOf: [cell, { type: 'array', items: cell, maxItems: 500 }] }, layer: { type: 'integer', minimum: 0 } }, ['column', 'op', 'value']);
export const selectionSchema = obj({
  selectionId, cellId, plot, digest: { type: 'string', pattern: '^[a-f0-9]{64}$' }, by: text, at: text, changeId, note: { type: 'string' },
  count: { type: 'integer', minimum: 0 }, layers: { type: 'array', items: obj({ layer: { type: 'integer', minimum: 0 }, geom: { type: 'string' }, marks: { type: 'integer', minimum: 0 } }) },
  marks: { type: 'array', items: mark },
}, ['selectionId', 'cellId', 'plot', 'digest', 'by', 'at', 'changeId', 'note', 'count', 'layers']);

export const operationContracts = {
  // summary (the default) says what was drawn; view adds the whole record a page draws from;
  // selections reads only the kept selections, with their marks.
  // marks, selection or where name marks whose rows to return, at most limit of them.
  'figure.read': {
    inputSchema: obj({ cellId, plot, form: { enum: ['summary', 'view', 'selections'] }, marks: { type: 'array', items: mark, maxItems: 5000 }, selection: selectionId,
      where: { type: 'array', items: where, minItems: 1, maxItems: 8 }, limit: { type: 'integer', minimum: 1, maximum: 500 } }, ['cellId', 'plot']),
    outputSchema: obj({ figure: { type: 'object' }, summary: { type: 'object' }, record: { type: 'object' }, selections: { type: 'array', items: selectionSchema },
      rows: { type: 'array', items: { type: 'object' } }, rowsTotal: { type: 'integer', minimum: 0 }, matched: { type: 'object' } }, ['figure', 'selections']),
    requires: [] as string[], effect: 'read' as const,
  },
  // Keeps a set of marks with a note, by whoever chose them: the person's selection that goes with a
  // message, or the marks an Agent points the person to. It changes neither the plot nor its data.
  'figure.select': {
    inputSchema: obj({ cellId, plot, marks: { type: 'array', items: mark, minItems: 1, maxItems: 5000 }, note: { type: 'string', maxLength: 500 }, changeId }, ['cellId', 'plot', 'marks', 'changeId']),
    outputSchema: obj({ selection: selectionSchema }),
    requires: [] as string[], effect: 'metadata' as const,
  },
};
