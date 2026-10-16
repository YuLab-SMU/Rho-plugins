export * from './common.js';
export * from './declarations.js';
import type { ResourceRef } from './common.js';
import type { Declaration } from './declarations.js';
export interface Resource {
  id: string; version: string; projectId: string; owner: string; kind: 'file' | 'table' | 'media' | 'object' | 'plot' | 'model'; path: string; bytes: number;
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
  limits: { maxBufferBytes: number };
  snapshot(id: string, expectedVersion: number): Promise<{ code: string; sha256: string; source: Record<string, any> }>;
}
export interface Environment { rscript: string; libraryPaths: string[] }
export interface ActionPlan { code: string; args: string[]; source: Record<string, any>; output: string | null; completion?: string | null }
export interface TableReader {
  rows(ref: ResourceRef): Promise<{ resource: Resource; rows: Record<string, any>[]; columns: import('./declarations.js').Column[]; entityKey: string | null; namespace: string | null }>;
}
export interface PluginDescriptor {
  id: string; package: string; version: string; requires: string[]; capabilities: string[];
  actions?: any[]; components?: any[]; agent?: Record<string, unknown>;
}
