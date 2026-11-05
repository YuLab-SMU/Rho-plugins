// This adapter uses sclet's public R API and Rho's public Notebook API. Scientific
// state, prerequisites, provenance and evidence remain on the SCE in R.
const quote = value => JSON.stringify(String(value));
const need = `if (!requireNamespace("sclet", quietly=TRUE) || !requireNamespace("jsonlite", quietly=TRUE)) stop("Install sclet and jsonlite in this R session's library, then check again. This plugin does not install R packages automatically.")`;
const object = name => `sce <- get(${quote(name)}, envir=.GlobalEnv, inherits=FALSE)
if (!inherits(sce, "SingleCellExperiment")) stop("Select a SingleCellExperiment in the shared R session.")`;
const json = expression => `cat(jsonlite::toJSON(${expression}, auto_unbox=TRUE, null="null", pretty=TRUE, force=TRUE), "\\n")`;
const plans = `if (!exists(".rho_sclet_plans", envir=.GlobalEnv, inherits=FALSE)) assign(".rho_sclet_plans", new.env(parent=emptyenv()), envir=.GlobalEnv)
plans <- get(".rho_sclet_plans", envir=.GlobalEnv)`;

export async function run(operation, input, ctx) {
  if (operation === 'sessions') { const value = await ctx.call('kernel.read', { limit: 1 }); return { sessions: value.sessions }; }
  if (operation === 'cell') return ctx.call('kernel.read', { cellId: input.cellId });
  let code;
  if (operation === 'check') code = `packages <- c("sclet", "SingleCellExperiment", "jsonlite")
for (pkg in packages) cat(pkg, if (requireNamespace(pkg, quietly=TRUE)) as.character(packageVersion(pkg)) else "MISSING — install in this R library", "\\n")
cat("R libraries:", paste(.libPaths(), collapse="; "), "\\n")`;
  else if (operation === 'skill') code = `${need}
cat(sclet::ReadAISkill(${quote(input.name)})$body, "\\n")`;
  else if (operation === 'ledger') code = `${need}
${object(input.object)}
${json(`sclet::GetAnalysisLedger(sce, include_artifacts=${input.includeArtifacts ? 'TRUE' : 'FALSE'}, include_data=FALSE)`)}`;
  else if (operation === 'registry') code = `${need}
${object(input.object)}
registry <- sclet::AIDefaultExecutionRegistry(sce, include="all")
${json('lapply(registry, function(action) action[intersect(names(action), c("name", "description", "input_schema", "output_schema", "mutates_object", "requires_confirmation", "estimated_cost", "idempotent"))])')}`;
  else if (operation === 'validate') code = `${need}
${object(input.object)}
${plans}
if (length(ls(plans, all.names=TRUE)) >= ${input.maxPlans ?? 32}L) stop("sclet maxPlans reached. Retain required plan records, or increase maxPlans (maximum 128); nothing was executed.")
args <- jsonlite::fromJSON(${quote(JSON.stringify(input.plan))}, simplifyVector=FALSE)
plan <- do.call(sclet::new_sclet_ai_plan, args)
registry <- sclet::AIDefaultExecutionRegistry(sce, include="all")
validation <- sclet::ValidateAIPlan(plan, object=sce, registry=registry)
assign(${quote(ctx.invocationId)}, list(object=${quote(input.object)}, plan=plan, validation=validation, used=FALSE), envir=plans)
visible <- validation; visible$confirmation_token <- NULL
${json(`list(validationId=${quote(ctx.invocationId)}, validation=visible)`)}`;
  else if (operation === 'execute') code = `${need}
if (!exists(".rho_sclet_plans", envir=.GlobalEnv, inherits=FALSE)) stop("Validation is not in this R session. Read the current ledger and validate a fresh plan.")
plans <- get(".rho_sclet_plans", envir=.GlobalEnv)
if (!exists(${quote(input.validationId)}, envir=plans, inherits=FALSE)) stop("Validation not found in this R session.")
selected <- get(${quote(input.validationId)}, envir=plans)
if (isTRUE(selected$used)) stop("This validation was already submitted. Observe the original cell; do not repeat it.")
if (!isTRUE(selected$validation$valid)) stop("The plan did not pass sclet validation. Read its errors and correct the plan.")
sce <- get(selected$object, envir=.GlobalEnv, inherits=FALSE)
registry <- sclet::AIDefaultExecutionRegistry(sce, include="all")
selected$used <- TRUE; assign(${quote(input.validationId)}, selected, envir=plans)
executed <- sclet::ExecuteAIPlan(sce, selected$plan, registry=registry, validation=selected$validation, dry_run=FALSE, confirmation=selected$validation$confirmation_token)
assign(selected$object, executed$object, envir=.GlobalEnv)
selected$result <- executed[setdiff(names(executed), c("object", "results"))]; assign(${quote(input.validationId)}, selected, envir=plans)
${json('list(status=executed$status, execution_id=executed$execution_id, success_assessment=executed$success_assessment, object=selected$object, fingerprint=sclet::GetAnalysisLedger(executed$object)$fingerprint)')}`;
  else if (operation === 'record') code = `${need}
${object(input.object)}
result <- jsonlite::fromJSON(${quote(JSON.stringify(input.result))}, simplifyVector=FALSE)
updated <- sclet::RecordAIResult(sce, result, id=${quote(input.recordId)}, audit_claims=TRUE)
assign(${quote(input.object)}, updated, envir=.GlobalEnv)
${json(`list(recordId=${quote(input.recordId)}, fingerprint=sclet::GetAnalysisLedger(updated)$fingerprint)`)}`;
  else if (operation === 'report') code = `${need}
${object(input.object)}
cat(sclet::RenderAIReport(sce, id=${input.recordId ? quote(input.recordId) : 'NULL'}), "\\n")`;
  else throw new Error('Unknown sclet operation.');
  // R evaluates local temporaries without replacing unrelated notebook variables.
  // Submission returns the original cell immediately; cell reads only observe it.
  return ctx.call('kernel.run', { language: 'r', code: `local({\n${code}\n})`, purpose: 'sclet: ' + operation, changeId: ctx.changeId(operation), waitMs: 0 });
}
