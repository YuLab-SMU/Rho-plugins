import { spawn } from 'node:child_process';
import path from 'node:path';
import { digest, now, requireThat, canonical, stateDirectory } from '@rho-workspace/plugin-contracts';
interface Environment { rscript: string; libraryPaths: string[] }
export interface Requirement { package: string; source: 'cran' | 'bioconductor'; minimumVersion?: string }
export function libraryPrefix(e: Environment) { return '.libPaths(c(c(' + e.libraryPaths.map(x => JSON.stringify(x)).join(',') + '), .libPaths()))\n'; }
export async function checkRequirements(root: string, requirements: Requirement[], rscript: string) {
  requireThat(Array.isArray(requirements) && requirements.length <= 64 && new Set(requirements.map(x => x.package)).size === requirements.length && requirements.every(x => /^[A-Za-z][A-Za-z0-9.]*$/.test(x.package) && ['cran', 'bioconductor'].includes(x.source) && (!x.minimumVersion || /^[0-9]+([.-][0-9]+)*$/.test(x.minimumVersion))), 'invalid', 'Select explicit unique R package requirements.');
  const environment = { rscript, libraryPaths: [path.join(root, '.rho/plugins/R-library')] };
  // Base R only: a probe never requires a scientific package or a Core Host.
  const code = libraryPrefix(environment) + `cat("R\\t", R.version.string, "\\n", sep="")
pkgs <- c(${requirements.map(x => JSON.stringify(x.package)).join(',')})
minimum <- c(${requirements.map(x => JSON.stringify(x.minimumVersion ?? '0')).join(',')})
for (i in seq_along(pkgs)) {
 p <- pkgs[[i]]; found <- find.package(p, quiet=TRUE)
 v <- if(length(found)) as.character(utils::packageVersion(p)) else ""
 ok <- length(found) && utils::compareVersion(v, minimum[[i]]) >= 0L
 cat(p, if(ok) "present" else "missing", v, sep="\\t"); cat("\\n")
}`;
  const native = await new Promise<any>(resolve => {
    const child = spawn(rscript, ['--vanilla', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let exceeded = false;
    const timer = setTimeout(() => { exceeded = true; child.kill('SIGKILL'); }, 20000);
    child.stdout.on('data', b => { if (Buffer.byteLength(output) + b.length > 1024 * 1024) { exceeded = true; child.kill('SIGKILL'); } else output += b.toString(); }); child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); resolve({ probe: 'unknown', reason: 'Selected Rscript is unavailable.' }); });
    child.on('close', exit => {
      clearTimeout(timer);
      const lines = output.trimEnd().split('\n');
      if (exit !== 0 || exceeded || !lines[0]?.startsWith('R\t') || lines.length !== requirements.length + 1) return resolve({ probe: 'unknown', reason: 'Dependency probe did not return complete bounded facts.' });
      const packages = lines.slice(1).map(line => { const [pkg, status, version] = line.split('\t'); return { package: pkg, status, version: version || null }; });
      resolve({ probe: 'checked', R: lines[0].slice(2), packages });
    });
  });
  const result = { requirements, checkedAt: now(), environment, native, status: native.probe !== 'checked' ? 'unknown' : native.packages.some((x: any) => x.status === 'missing') ? 'missing' : 'present' };
  return { ...result, checkId: digest(canonical(result)) };
}
export async function preparation(root: string, requirements: Requirement[], rscript: string) {
  const check = await checkRequirements(root, requirements, rscript);
  requireThat(check.status !== 'unknown', 'condition', 'Resolve the selected R installation before preparation.', { check });
  const missing = requirements.filter(p => check.native.packages.some((n: any) => n.package === p.package && n.status === 'missing'));
  requireThat(missing.length > 0, 'condition', 'No selected packages are missing.', { check });
  const library = await stateDirectory(root, '.rho/plugins/R-library');
  let code = libraryPrefix(check.environment);
  for (const source of ['cran', 'bioconductor']) {
    const packages = missing.filter(p => p.source === source).map(p => JSON.stringify(p.package)).join(',');
    if (!packages) continue;
    code += source === 'cran' ? `utils::install.packages(c(${packages}), lib=${JSON.stringify(library)}, repos="https://cloud.r-project.org", Ncpus=1L)\n` : `if (!requireNamespace("BiocManager",quietly=TRUE)) stop("Install BiocManager in the selected R installation first")\nBiocManager::install(c(${packages}), lib=${JSON.stringify(library)}, ask=FALSE, update=FALSE, Ncpus=1L)\n`;
  }
  return { code, args: [] as string[], source: { kind: 'dependency-preparation', requirements, library, before: check }, output: null };
}

export const plugin = { id: 'requirements', package: '@rho-workspace/plugin-requirements', version: '0.4.0', requires: [], capabilities: ['requirements'] };
