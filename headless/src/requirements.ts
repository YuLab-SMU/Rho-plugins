import { spawn } from 'node:child_process';
import path from 'node:path';
import { actions } from './catalog.js';
import { digest, now, requireThat, canonical, stateDirectory } from './common.js';
export interface Environment { rscript: string; libraryPaths: string[] }
export function libraryPrefix(environment: Environment) { return '.libPaths(c(' + environment.libraryPaths.map(x => JSON.stringify(x)).join(',') + ', .libPaths()))\n'; }
export async function checkRequirements(root: string, actionId: string, rscript: string) {
  const action = actions.find(x => x.id === actionId);
  requireThat(action, 'unavailable', 'Unknown scientific action.');
  const environment = { rscript, libraryPaths: [path.join(root, '.rho/plugins/R-library')] };
  // A selected action check observes its R installation, not an inferred project
  // dependency graph. No Host or scientific script is started by this operation.
  const code = libraryPrefix(environment) + `pkgs <- c(${action.packages.map(x => JSON.stringify(x)).join(',')})
if (!requireNamespace("jsonlite", quietly=TRUE)) { cat('{"probe":"unknown","reason":"jsonlite unavailable"}'); quit(status=0) }
items <- lapply(pkgs, function(p) { found <- requireNamespace(p, quietly=TRUE); list(package=p, status=if(found) "present" else "missing", version=if(found) as.character(utils::packageVersion(p)) else NULL, library=if(found) dirname(find.package(p)) else NULL) })
cat(jsonlite::toJSON(list(probe="checked", R=R.version.string, libraryPaths=.libPaths(), packages=items), auto_unbox=TRUE, null="null"))`;
  const native = await new Promise<any>(resolve => {
    const child = spawn(rscript, ['--vanilla', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let exceeded = false;
    const timer = setTimeout(() => { exceeded = true; child.kill('SIGKILL'); }, 20000);
    child.stdout.on('data', b => { if (Buffer.byteLength(output) + b.length > 1024 * 1024) { exceeded = true; child.kill('SIGKILL'); } else output += b.toString(); }); child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); resolve({ probe: 'unknown', reason: 'Selected Rscript is unavailable.' }); });
    child.on('close', exit => { clearTimeout(timer); try { resolve(exit === 0 && !exceeded ? JSON.parse(output) : { probe: 'unknown', reason: 'Dependency probe did not complete within its budget.' }); } catch { resolve({ probe: 'unknown', reason: 'Dependency probe returned no usable facts.' }); } });
  });
  const result = { action: actionId, actionVersion: action.version, checkedAt: now(), environment, native, status: native.probe !== 'checked' ? 'unknown' : native.packages.some((x: any) => x.status === 'missing') ? 'missing' : 'present' };
  return { ...result, checkId: digest(canonical(result)) };
}
export async function preparation(root: string, actionId: string, rscript: string) {
  const check = await checkRequirements(root, actionId, rscript);
  requireThat(check.status !== 'unknown', 'condition', 'Resolve the unknown R installation before package preparation.', { check });
  const packages = check.native.packages.filter((p: any) => p.status === 'missing').map((p: any) => p.package);
  requireThat(packages.length > 0, 'condition', 'No selected action packages are missing.', { check });
  const library = await stateDirectory(root, '.rho/plugins/R-library');
  const code = libraryPrefix(check.environment) + `if (!requireNamespace("BiocManager",quietly=TRUE)) stop("Install BiocManager in the selected R installation first")
BiocManager::install(c(${packages.map((x: string) => JSON.stringify(x)).join(',')}), lib=${JSON.stringify(library)}, ask=FALSE, update=FALSE, Ncpus=1L)
stopifnot(all(vapply(c(${packages.map((x: string) => JSON.stringify(x)).join(',')}), requireNamespace, logical(1), quietly=TRUE)))
`;
  return { code, args: [] as string[], source: { kind: 'dependency-preparation', packages, library, source: 'BiocManager repositories for the selected R/Bioconductor installation', before: check }, output: null };
}
