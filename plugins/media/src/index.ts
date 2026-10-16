import { objectSchema as obj, text, requireThat, publicResource, validateDeclarationEnvelope, type Declaration, type ResourceRef, type ResourceStore } from '@rho-workspace/plugin-contracts';
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
    return { resource: publicResource(r), original: ref, ...r.format, rendering: 'unavailable' };
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
export const plugin = { id: 'media', package: '@rho-workspace/plugin-media', version: '0.4.0', requires: ['files'], capabilities: ['media'], components: [{ id: 'rho.media', version: '0.2.0', owner: 'rho-plugins.media', bindings: { data: 'media' }, ui: 'unavailable', propsSchema: obj({ title: text }) }] };
