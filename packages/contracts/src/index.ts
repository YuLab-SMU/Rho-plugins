export * from './common.js';
export * from './declarations.js';
export type { EntryPresentation, PluginPresentation } from './presentation.js';
import type { ResourceRef } from './common.js';
import type { Declaration } from './declarations.js';
export interface Resource {
  id: string; version: string; projectId: string; owner: string; kind: string; path: string; bytes: number;
  provenance: Record<string, any>; coverage: Record<string, any>; availability: 'available' | 'partial' | 'missing' | 'unknown'; storage: string; format?: Record<string, any> | string;
}
export const publicResource = ({ storage, ...resource }: Resource) => resource;

export interface ResourceStore {
  root: string; projectId: string;
  limits: { maxFileBytes: number; maxResources: number; maxArtifactBytes: number; maxReadBytes: number };
  validateDeclaration(declaration: Declaration): void;
  list(): Promise<Resource[]>;
  resolve(ref: ResourceRef): Promise<Resource>;
  bytes(ref: ResourceRef): Promise<{ r: Resource; data: Buffer }>;
  read(ref: ResourceRef, offset: number, maxBytes?: number): Promise<any>;
  register(relative: string, provenance: Record<string, any>, availability: Resource['availability'], coverage?: Record<string, any>, declaration?: Declaration, expectedDigest?: string): Promise<Resource>;
  restore(metadata: Resource, data: Uint8Array): Promise<any>;
}
export interface DocumentSnapshotSource {
  snapshot(id: string, expectedVersion: number): Promise<{ code: string; sha256: string; source: Record<string, any> }>;
}
export interface ActionPlan { code: string; args: string[]; source: Record<string, any>; output: string | null; completion?: string | null }
export interface TableReader {
  rows(ref: ResourceRef): Promise<{ resource: Resource; rows: Record<string, any>[]; columns: { name: string; type: 'string' | 'number' | 'boolean' }[]; entityKey: string | null; namespace: string | null }>;
}
export interface ActionDeclaration {
  id: string; version: string; owner: string; requires: string[];
  inputSchema: Record<string, any>; capabilities?: string[]; effects?: string[]; cancellation?: string;
  presentation?: import('./presentation.js').EntryPresentation;
}
export interface ComponentDescriptor {
  id: string; version: string; owner: string; ui: string;
  bindings: Record<string, string>; propsSchema: Record<string, any>;
  presentation?: import('./presentation.js').EntryPresentation;
}
export interface PluginDescriptor {
  id: string; package: string; version: string; requires: string[]; capabilities: string[];
  presentation?: import('./presentation.js').PluginPresentation;
  actions?: ActionDeclaration[]; components?: ComponentDescriptor[]; agent?: Record<string, unknown>;
  entryVersion: '1.0';
  operations: import('./common.js').OperationDeclaration[];
  skills: import('./common.js').SkillDeclaration[];
}
