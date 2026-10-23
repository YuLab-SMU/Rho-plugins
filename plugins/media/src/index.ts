import { skillPresentation, presentation, operationPresentation, viewPresentation } from './presentation.js';
import { operationContracts } from './operations.js';
import { objectSchema as obj, text, requireThat, publicResource, validateDeclarationEnvelope, type Declaration, type ResourceRef, type ResourceStore, digest } from '@rho-workspace/plugin-contracts';

const declaredSkill = (id: string, content: string, version = '1.0') => ({ id, version, content, digest: digest(content) });
export function validateMediaDeclaration(d: Declaration) {
  validateDeclarationEnvelope(d); requireThat(d.kind === 'media', 'invalid', 'Select a media declaration.');
  const f = d.format as any;
  requireThat(['image/png', 'image/jpeg', 'image/svg+xml', 'application/pdf'].includes(f.mimeType) && (f.pages === undefined || Number.isSafeInteger(f.pages) && f.pages > 0) && ['width', 'height'].every(k => f[k] === undefined || Number.isFinite(f[k]) && f[k] > 0), 'invalid', 'Media dimensions and page counts must be finite positive declarations.');
}
export const declarationValidator = { kind: 'media', validate: validateMediaDeclaration };
export class Media {
  constructor(public files: Pick<ResourceStore, 'resolve'>) {}
  async describe(ref: ResourceRef) {
    const r = await this.files.resolve(ref);
    requireThat(r.kind === 'media' && typeof r.format === 'object', 'invalid', 'Select declared original media.');
    return { resource: publicResource(r), original: ref, ...r.format, rendering: 'unobserved' };
  }
  async region(ref: ResourceRef, region: any) {
    const r = await this.files.resolve(ref);
    requireThat(r.kind === 'media' && typeof r.format === 'object', 'invalid', 'Coordinate context requires original media.');
    requireThat(Number.isSafeInteger(region.page) && region.page >= 1 &&
      [region.x, region.y, region.width, region.height].every(Number.isFinite) &&
      region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0,
      'invalid', 'Media region requires a positive page and finite nonnegative coordinates and positive dimensions.');
    const f = r.format;
    requireThat(region.page <= (f.pages ?? 1) && region.units === (f.mimeType === 'application/pdf' ? 'points' : 'pixels'), 'condition', 'Media region page or units do not match the declaration.');
    requireThat(f.width && f.height && region.x + region.width <= f.width && region.y + region.height <= f.height, 'condition', 'Media region exceeds declared page dimensions.');
    return { ...region, resource: ref, mapping: 'original-media-coordinates' };
  }
}
const mediaSkillContent = [
  'Describe and select a region of registered media without touching its bytes.',
  'Use capability.list to discover media.describe and object.read.',
  '',
  '1. Register the media first and keep its exact {id, version}. Coordinates are declared',
  '   in original media space: width and height come from the declaration, not from what a',
  '   renderer happens to show.',
  '2. media.describe reports the stored description of that version. Rendering is optional',
  '   and never changes source bytes; a region selection maps back to original coordinates.',
  '3. A region outside the declared bounds is refused rather than clamped, so a zoomed or',
  '   cropped view cannot invent pixels that are not in the file.',
  '4. If the file changed, the version is stale: register the new bytes instead of reusing',
  '   coordinates that belonged to the old ones.'
].join('\n');
const mediaSkill = {
  ...declaredSkill('media.workspace', mediaSkillContent, '1.1'),
  intent: 'Describe media and select a region in original coordinates.',
  requires: ['media.describe', 'resource.register', 'object.read'],
  example: {
    method: 'media.describe',
    input: { resource: { id: '9f1c2d3e4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff0', version: '3f9d2b0e1a4c5f6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5' } }
  },
  failureRecipes: [
    { kind: 'invalid', message: 'Region lies outside the declared media bounds.', next: 'Use coordinates inside width and height from the registration; a region is never clamped.' },
    { kind: 'stale', message: 'Resource version changed.', next: 'Re-register the current bytes and describe the new version.' },
    { kind: 'unavailable', message: 'This build selects no renderer.', next: 'Describe and select stay available; only rendering is missing.' }
  ],
  verify: { command: 'npm run test:media', description: 'Registers media, maps a selection to original coordinates, and refuses a region outside the declared bounds.' }
};
export const plugin = { entryVersion: '1.0', id: 'media', package: '@rho-workspace/plugin-media', version: '0.4.0', requires: ['files'], capabilities: ['media'], presentation,
  operations: Object.entries(operationContracts).map(([method, contract]) => ({ method, presentation: operationPresentation[method as keyof typeof operationPresentation], version: '2.0' as const, ...structuredClone(contract), requires: [...contract.requires] })), skills: [{ ...mediaSkill, presentation: skillPresentation }],
  components: [{ id: 'rho.media', version: '0.2.0', owner: 'rho-plugins.media', bindings: { data: 'media' }, ui: './ui', presentation: viewPresentation, propsSchema: obj({ title: text }) }] };
