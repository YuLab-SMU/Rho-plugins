import { objectSchema as obj } from '@rho-workspace/plugin-contracts';
export const requirementSchema = obj({ package: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9.]*$' }, source: { enum: ['cran', 'bioconductor'] }, minimumVersion: { type: 'string', pattern: '^[0-9]+([.-][0-9]+)*$' } }, ['package', 'source']);
export const requirementsSchema = { type: 'array', items: requirementSchema, maxItems: 64, uniqueItems: true };
