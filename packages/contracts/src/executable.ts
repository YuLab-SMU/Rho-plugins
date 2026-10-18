import * as fs from 'node:fs/promises';
import path from 'node:path';

// Observes executable files only. It never runs the selected program or claims
// its version, packages, compatibility or readiness for an action.
export async function observeExecutable(program: string, searchPath = process.env.PATH ?? '', maxSearchDirectories = 128) {
  const checkedAt = new Date().toISOString();
  const direct = program.includes(path.sep);
  const directories = direct ? [] : searchPath.split(path.delimiter);
  if (directories.length > maxSearchDirectories) return { state: 'unknown' as const, checkedAt, scope: 'executable-file', limit: 'maxSearchDirectories', maximum: maxSearchDirectories };
  const candidates = direct ? [path.resolve(program)] : directories.map(directory => path.resolve(directory, program));
  let unreadable = false;
  for (const candidate of candidates) {
    try {
      if (!(await fs.stat(candidate)).isFile()) continue;
      try {
        await fs.access(candidate, fs.constants.X_OK);
        return { state: 'present' as const, checkedAt, scope: 'executable-file' };
      } catch (error: any) { if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) unreadable = true; }
    } catch (error: any) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) unreadable = true; }
  }
  return { state: unreadable ? 'unknown' as const : 'missing' as const, checkedAt, scope: 'executable-file' };
}
