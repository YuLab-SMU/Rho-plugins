import * as fs from 'node:fs/promises';
import path from 'node:path';
import { confined, requireThat } from '@rho-workspace/plugin-contracts';

export interface SourceFolder { id: string; root: string; name: string }
export interface FilePaths { resolve(relative: string, missing?: boolean): Promise<{ file: string; relative: string }> }

// A finite set of user-selected folders. References carry a stable source ID,
// so equal filenames in different folders never become the same document.
export class ProjectPaths implements FilePaths {
  constructor(private root: string, private sources: SourceFolder[]) {}
  async resolve(relative: string, missing = false) {
    const parts = relative.split('/');
    const qualified = parts.length > 1 && parts[0]?.startsWith('@');
    const source = qualified ? this.sources.find(s => '@' + s.id === parts[0]) : undefined;
    requireThat(!qualified || source, 'scope', 'This source folder is not part of the project.');
    const base = source?.root ?? this.root;
    requireThat(await fs.realpath(base) === base, 'scope', 'A source folder changed location. Add its current location before using it.');
    const selected = source ? parts.slice(1).join('/') : relative;
    if (source) requireThat(!selected.split(/[\\/]/).some(p => ['.rho', '.git'].includes(p)), 'scope', 'Internal state is not a source file.');
    const file = await confined(base, selected, missing);
    // Normalize overlapping source aliases to one logical buffer within a project.
    if (file === this.root || file.startsWith(this.root + path.sep)) return { file, relative: path.relative(this.root, file) || '.' };
    const canonical = this.sources.find(s => file === s.root || file.startsWith(s.root + path.sep));
    requireThat(canonical, 'scope', 'File is outside the selected source folders.');
    return { file, relative: '@' + canonical.id + '/' + (path.relative(canonical.root, file).split(path.sep).join('/') || '.') };
  }
}
