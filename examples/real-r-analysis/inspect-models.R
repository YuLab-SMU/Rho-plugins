#!/usr/bin/env Rscript
# Read saved native state. No DESeq(), dispersion fit or coefficient fit is run.
options(stringsAsFactors = FALSE, warn = 1)
args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 2L) {
  message("usage: Rscript --vanilla inspect-models.R OUTPUT_DIRECTORY NEW_REPORT_JSON")
  quit(status = 1L, save = "no")
}

started <- Sys.time()
stamp <- function() format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z", tz = "UTC")
report_path <- NULL
report <- list(schema_version = 1L, status = "running", started_at = stamp(),
               output_directory = args[[1L]], tolerance = 1e-9,
               scope = paste("Read-only observation using the same installed R packages as the native analysis;",
                             "not an independent statistical oracle. No model is refitted."),
               checks = list(), models = list())

require <- function(condition, description) {
  ok <- isTRUE(condition)
  report$checks[[length(report$checks) + 1L]] <<- list(check = description, passed = ok)
  if (!ok) stop(description, call. = FALSE)
}
equal <- function(actual, expected, description) {
  comparison <- all.equal(actual, expected, tolerance = 1e-9, check.attributes = FALSE)
  require(isTRUE(comparison), if (isTRUE(comparison)) description else
            paste0(description, ": ", paste(comparison, collapse = "; ")))
}
read_csv <- function(relative, columns) {
  value <- utils::read.csv(file.path(out, relative), check.names = FALSE,
                          na.strings = c("", "NA"))
  require(!anyDuplicated(names(value)) && all(columns %in% names(value)),
          paste0(relative, " required unique columns"))
  value
}
write_report <- function() {
  report$completed_at <<- stamp()
  report$elapsed_seconds <<- as.numeric(difftime(Sys.time(), started, units = "secs"))
  report$R <<- R.version.string
  loaded <- sort(loadedNamespaces())
  report$packages <<- data.frame(package = loaded,
                                version = vapply(loaded, function(p) as.character(utils::packageVersion(p)), ""))
  tmp <- paste0(report_path, ".partial")
  jsonlite::write_json(report, tmp, auto_unbox = TRUE, pretty = TRUE,
                       null = "null", na = "null", digits = NA)
  if (!file.rename(tmp, report_path)) stop("could not publish native observation report")
}

main <- function() {
  # Canonicalize the report's parent before allowing any write. It cannot be an
  # artifact, even when a caller supplies a symlinked parent or lexical '..'.
  out <<- normalizePath(args[[1L]], mustWork = TRUE)
  if (!dir.exists(out)) stop("output directory must exist")
  parent <- normalizePath(dirname(args[[2L]]), mustWork = TRUE)
  leaf <- basename(args[[2L]])
  if (leaf %in% c("", ".", "..")) stop("invalid report filename")
  destination <- file.path(parent, leaf)
  if (identical(destination, out) || startsWith(destination, paste0(out, "/"))) {
    stop("report must be outside the immutable artifact directory")
  }
  if (file.exists(destination) || file.exists(paste0(destination, ".partial"))) {
    stop("report destination already exists; original evidence preserved")
  }
  report_path <<- destination
  report$output_directory <<- out
  if (!requireNamespace("jsonlite", quietly = TRUE)) stop("missing installed package: jsonlite")
  for (pkg in c("DESeq2", "SummarizedExperiment", "S4Vectors", "digest")) {
    require(requireNamespace(pkg, quietly = TRUE), paste0("installed package ", pkg))
  }
  suppressPackageStartupMessages(library(DESeq2))
  require(file.exists(file.path(out, "complete.json")), "completed artifact marker exists")
  source_versions <- read_csv("versions.csv", c("package", "version"))
  native_packages <- c("DESeq2", "SummarizedExperiment", "S4Vectors")
  report$analysis_packages <<- source_versions[source_versions$package %in% native_packages,
                                              c("package", "version"), drop = FALSE]
  for (pkg in native_packages) {
    expected_version <- source_versions$version[source_versions$package == pkg]
    require(length(expected_version) == 1L &&
              identical(expected_version, as.character(utils::packageVersion(pkg))),
            paste0("native observation package version matches analysis: ", pkg))
  }

  raw <- read_csv("input/counts.csv", "gene_id")
  samples <- read_csv("input/samples.csv", c("sample_id", "cell", "dex", "albut"))
  prefilter <- read_csv("input/prefilter.csv", c("gene_id", "kept"))
  normalizations <- read_csv("normalization.csv", c("analysis_id", "sample_id", "size_factor"))
  plan <- read_csv("analysis_plan.csv", c("analysis_id", "omitted_donor", "n_genes", "n_samples"))
  require(nrow(raw) == 63677L && nrow(samples) == 8L &&
            identical(names(raw)[-1L], samples$sample_id) && !anyDuplicated(raw$gene_id),
          "original input dimensions and sample/gene identity")
  counts <- as.matrix(raw[, -1L, drop = FALSE])
  rownames(counts) <- raw$gene_id
  require(all(is.finite(counts)) && all(counts >= 0) && all(counts == floor(counts)),
          "original raw counts are nonnegative finite integers")
  keep <- rowSums(counts >= 10L) >= 4L
  require(identical(prefilter$gene_id, raw$gene_id) && identical(unname(prefilter$kept), unname(keep)) &&
            sum(keep) == 16139L, "recomputed fixed input prefilter")
  donors <- sort(unique(samples$cell))
  require(length(donors) == 4L && all(samples$albut == "untrt") &&
            all(table(samples$cell, samples$dex) == 1L), "original four donor pairs")
  ids <- c("full", paste0("without_", donors))
  require(identical(plan$analysis_id, ids), "five planned model identities and order")
  observed_files <- sort(list.files(file.path(out, "models"), pattern = "[.]rds$"))
  require(identical(observed_files, sort(paste0(ids, ".rds"))), "exact five RDS model files")
  result_columns <- c("baseMean", "log2FoldChange", "lfcSE", "stat", "pvalue", "padj")

  for (i in seq_along(ids)) {
    id <- ids[[i]]
    omitted <- if (i == 1L) NA_character_ else donors[[i - 1L]]
    selected <- if (is.na(omitted)) rep(TRUE, nrow(samples)) else samples$cell != omitted
    expected <- counts[keep, selected, drop = FALSE]
    rds_path <- file.path(out, "models", paste0(id, ".rds"))
    dds <- readRDS(rds_path)
    require(inherits(dds, "DESeqDataSet"), paste0(id, " native DESeqDataSet read back"))
    f <- DESeq2::design(dds)
    tm <- stats::terms(f)
    require(length(f) == 2L && identical(attr(tm, "term.labels"), c("cell", "dex")) &&
              attr(tm, "intercept") == 1L, paste0(id, " native ~ cell + dex design"))
    require(identical(dim(dds), dim(expected)) && identical(rownames(dds), rownames(expected)) &&
              identical(colnames(dds), colnames(expected)), paste0(id, " native model dimensions and ordered identities"))
    # Counts must be exactly identical; the floating-point tolerance is only
    # applied to fitted numerical observations and CSV rounding.
    require(identical(dimnames(DESeq2::counts(dds)), dimnames(expected)) &&
              all(DESeq2::counts(dds) == expected), paste0(id, " all native counts equal fixed selected input"))
    cd <- as.data.frame(SummarizedExperiment::colData(dds))
    selected_samples <- samples[selected, , drop = FALSE]
    require(identical(as.character(cd$cell), selected_samples$cell) &&
              identical(as.character(cd$dex), selected_samples$dex) &&
              identical(levels(cd$dex), c("untrt", "trt")) &&
              all(table(cd$cell, cd$dex) == 1L), paste0(id, " native donor/treatment pairing and reference"))
    require(isTRUE(all.equal(plan$omitted_donor[[i]], omitted)) &&
              plan$n_genes[[i]] == nrow(dds) && plan$n_samples[[i]] == ncol(dds),
            paste0(id, " exported plan matches native dimensions and omission"))
    norm <- normalizations[normalizations$analysis_id == id, , drop = FALSE]
    require(identical(norm$sample_id, colnames(dds)), paste0(id, " normalization sample order"))
    equal(DESeq2::sizeFactors(dds), norm$size_factor, paste0(id, " native size factors equal CSV"))
    exported <- read_csv(paste0("results/", id, ".csv"),
                         c("gene_id", result_columns, "dispersion", "beta_converged"))
    require(identical(exported$gene_id, rownames(dds)), paste0(id, " result gene order"))
    equal(DESeq2::dispersions(dds), exported$dispersion, paste0(id, " native dispersions equal CSV"))
    equal(S4Vectors::mcols(dds)$betaConv, exported$beta_converged,
          paste0(id, " native coefficient convergence equals CSV"))
    native <- DESeq2::results(dds, contrast = c("dex", "trt", "untrt"), test = "Wald",
                             alpha = 0.05, independentFiltering = FALSE,
                             pAdjustMethod = "BH", parallel = FALSE)
    require(identical(rownames(native), exported$gene_id), paste0(id, " native result gene identity"))
    for (column in result_columns) {
      equal(native[[column]], exported[[column]], paste0(id, " native results ", column, " equals CSV"))
    }
    if (id == "full") {
      means <- read_csv("bootstrap/means.csv", c("gene_id", colnames(dds)))
      dispersions <- read_csv("bootstrap/dispersion.csv", c("gene_id", "dispersion"))
      require(identical(means$gene_id, rownames(dds)) &&
                identical(names(means)[-1L], colnames(dds)) &&
                identical(dispersions$gene_id, rownames(dds)), "full bootstrap parameter identities")
      equal(SummarizedExperiment::assay(dds, "mu"), as.matrix(means[, -1L, drop = FALSE]),
            "full native fitted means equal all exported simulation means")
      equal(DESeq2::dispersions(dds), dispersions$dispersion,
            "full native dispersions equal all exported simulation dispersions")
    }
    report$models[[length(report$models) + 1L]] <<- list(
      analysis_id = id, path = rds_path,
      sha256 = digest::digest(file = rds_path, algo = "sha256"),
      genes = nrow(dds), samples = ncol(dds), donors = sort(unique(as.character(cd$cell))),
      sample_ids = colnames(dds), design = paste(deparse(f), collapse = " "),
      coefficient = "dex_trt_vs_untrt", result_columns_checked = result_columns,
      unconverged_genes = sum(!S4Vectors::mcols(dds)$betaConv, na.rm = TRUE))
    rm(dds, native)
  }
  require(length(report$models) == 5L, "all five saved models observed without refitting")
  report$status <<- "passed"
  write_report()
  cat(jsonlite::toJSON(list(status = "passed", models_read = 5L,
                           checks_passed = length(report$checks), report = report_path), auto_unbox = TRUE), "\n")
}

tryCatch(main(), error = function(e) {
  report$status <<- "failed"
  report$error <<- list(message = conditionMessage(e), class = class(e))
  if (!is.null(report_path) && requireNamespace("jsonlite", quietly = TRUE)) {
    tryCatch(write_report(), error = function(write_error) {
      message("report publication failed: ", conditionMessage(write_error))
    })
  }
  message("native observation failed: ", conditionMessage(e))
  quit(status = 1L, save = "no")
})
