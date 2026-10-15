#!/usr/bin/env Rscript
# This entire file is the request's code snapshot. It does not source other files.
options(stringsAsFactors = FALSE, warn = 1)
args <- commandArgs(trailingOnly = TRUE)
if (!length(args) %in% 1:2) stop("usage: Rscript --vanilla analyze.R NEW_OUTPUT_DIRECTORY [BOOTSTRAP_REPLICATES]")
bootstrap_replicates <- if (length(args) == 2L && grepl("^[0-9]+$", args[[2L]])) as.integer(args[[2L]]) else if (length(args) == 1L) 200L else NA_integer_
if (is.na(bootstrap_replicates) || bootstrap_replicates < 1L || bootstrap_replicates > 1000L) stop("BOOTSTRAP_REPLICATES must be an integer from 1 to 1000")

required <- c("DESeq2", "airway", "SummarizedExperiment", "jsonlite", "digest")
for (pkg in required) {
  if (!requireNamespace(pkg, quietly = TRUE)) stop("missing installed package: ", pkg)
}

parent <- normalizePath(dirname(args[[1L]]), mustWork = TRUE)
leaf <- basename(args[[1L]])
if (!dir.exists(parent) || leaf %in% c("", ".", "..")) stop("invalid output directory")
out <- file.path(parent, leaf)
started <- Sys.time()
stamp <- function() format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3%z", tz = "UTC")
json <- function(x) jsonlite::toJSON(x, auto_unbox = TRUE, pretty = TRUE,
                                    null = "null", na = "null", digits = NA)
entry <- list(pid = Sys.getpid(), entered_at = stamp(), output_directory = out)
cat(jsonlite::toJSON(entry, auto_unbox = TRUE), "\n", sep = "",
    file = paste0(out, ".entries.jsonl"), append = TRUE)
if (file.exists(out)) stop("output directory already exists; original artifacts preserved")
if (!dir.create(out, recursive = FALSE)) stop("could not create output directory")

write_json <- function(x, path) {
  tmp <- paste0(path, ".partial")
  writeLines(json(x), tmp, useBytes = TRUE)
  if (!file.rename(tmp, path)) stop("could not publish ", path)
}
write_csv <- function(x, path) utils::write.csv(x, path, row.names = FALSE, na = "")
progress <- function(stage, ...) {
  cat(jsonlite::toJSON(c(list(stage = stage, at = stamp()), list(...)),
                       auto_unbox = TRUE), "\n", sep = "")
  flush(stdout())
}

main <- function() {
  RNGkind("Mersenne-Twister", "Inversion", "Rejection")
  set.seed(52778L)
  for (name in c("input", "results", "models", "plots", "bootstrap")) dir.create(file.path(out, name))
  suppressPackageStartupMessages(library(DESeq2))
  suppressPackageStartupMessages(library(airway))
  data("airway", package = "airway")
  cts <- SummarizedExperiment::assay(airway)
  samples <- as.data.frame(SummarizedExperiment::colData(airway))
  genes <- as.data.frame(SummarizedExperiment::rowData(airway))
  samples$sample_id <- rownames(samples)
  samples <- samples[, c("sample_id", setdiff(names(samples), "sample_id"))]
  genes$gene_id <- rownames(cts)
  genes <- genes[, c("gene_id", setdiff(names(genes), "gene_id"))]
  # The public dataset fixes the workload: 509,416 integer observations and five fits.
  stopifnot(identical(dim(cts), c(63677L, 8L)), identical(colnames(cts), samples$sample_id),
            identical(rownames(cts), genes$gene_id), all(is.finite(cts)), all(cts >= 0),
            all(cts == floor(cts)), length(unique(samples$cell)) == 4L,
            all(samples$albut == "untrt"), all(table(samples$cell, samples$dex) == 1L))
  samples$cell <- factor(samples$cell)
  samples$dex <- factor(samples$dex, levels = c("untrt", "trt"))
  rownames(samples) <- samples$sample_id
  keep <- rowSums(cts >= 10L) >= 4L
  stopifnot(sum(keep) == 16139L)
  write_csv(data.frame(gene_id = rownames(cts), cts, check.names = FALSE),
            file.path(out, "input", "counts.csv"))
  write_csv(samples, file.path(out, "input", "samples.csv"))
  write_csv(genes, file.path(out, "input", "genes.csv"))
  write_csv(data.frame(gene_id = rownames(cts), kept = keep),
            file.path(out, "input", "prefilter.csv"))
  progress("input_ready", genes = nrow(cts), samples = ncol(cts), kept_genes = sum(keep))

  donors <- sort(unique(as.character(samples$cell)))
  known <- c("CRISPLD2", "DUSP1", "FKBP5", "KLF15", "PER1", "TSC22D3")
  plans <- list()
  normalizations <- list()
  results <- list()
  fitted <- list()
  for (i in seq_len(5L)) {
    omitted <- if (i == 1L) NA_character_ else donors[[i - 1L]]
    id <- if (i == 1L) "full" else paste0("without_", omitted)
    selected <- if (is.na(omitted)) rep(TRUE, nrow(samples)) else samples$cell != omitted
    cd <- droplevels(samples[selected, , drop = FALSE])
    X <- stats::model.matrix(~ cell + dex, data = cd)
    stopifnot(qr(X)$rank == ncol(X), nrow(X) > ncol(X),
              all(table(cd$cell, cd$dex) == 1L))
    dds <- DESeq2::DESeqDataSetFromMatrix(cts[keep, selected, drop = FALSE], cd,
                                        design = ~ cell + dex)
    progress("fit_started", analysis_id = id, samples = ncol(dds), genes = nrow(dds))
    timing <- system.time({
      dds <- DESeq2::DESeq(dds, test = "Wald", fitType = "parametric", sfType = "ratio",
                           betaPrior = FALSE, parallel = FALSE, quiet = FALSE)
      res <- DESeq2::results(dds, contrast = c("dex", "trt", "untrt"), test = "Wald",
                            alpha = 0.05, independentFiltering = FALSE,
                            pAdjustMethod = "BH", parallel = FALSE)
    })
    stopifnot("dex_trt_vs_untrt" %in% DESeq2::resultsNames(dds))
    tab <- data.frame(gene_id = rownames(res),
                      symbol = as.character(genes$symbol[match(rownames(res), genes$gene_id)]),
                      as.data.frame(res), dispersion = DESeq2::dispersions(dds),
                      beta_converged = S4Vectors::mcols(dds)$betaConv,
                      max_cooks = S4Vectors::mcols(dds)$maxCooks,
                      check.names = FALSE)
    write_csv(tab, file.path(out, "results", paste0(id, ".csv")))
    saveRDS(dds, file.path(out, "models", paste0(id, ".rds")), compress = "gzip")
    results[[id]] <- tab
    fitted[[id]] <- dds
    plans[[id]] <- data.frame(analysis_id = id, omitted_donor = omitted,
                             n_donors = length(unique(cd$cell)), n_samples = ncol(dds),
                             n_genes = nrow(dds), design_rank = qr(X)$rank,
                             residual_df = nrow(X) - ncol(X), design = "~ cell + dex",
                             coefficient = "dex_trt_vs_untrt", contrast = "dex:trt:untrt",
                             test = "Wald", fit_type = "parametric", sf_type = "ratio",
                             beta_prior = FALSE, independent_filtering = FALSE,
                             cook_policy = "DESeq2 default", p_adjust_method = "BH",
                             alpha = 0.05, elapsed_seconds = unname(timing[["elapsed"]]))
    normalizations[[id]] <- data.frame(analysis_id = id, sample_id = colnames(dds),
                                      size_factor = DESeq2::sizeFactors(dds),
                                      library_size = colSums(DESeq2::counts(dds)))
    progress("fit_completed", analysis_id = id, elapsed_seconds = unname(timing[["elapsed"]]),
             tested_pvalues = sum(is.finite(tab$pvalue)),
             significant = sum(tab$padj < 0.05, na.rm = TRUE),
             unconverged = sum(!tab$beta_converged, na.rm = TRUE))
  }
  write_csv(do.call(rbind, plans), file.path(out, "analysis_plan.csv"))
  write_csv(do.call(rbind, normalizations), file.path(out, "normalization.csv"))
  known_rows <- do.call(rbind, lapply(names(results), function(id) {
    tab <- results[[id]]
    z <- tab[tab$symbol %in% known, , drop = FALSE]
    cbind(analysis_id = id, expected_direction = "positive", z)
  }))
  write_csv(known_rows, file.path(out, "known_genes.csv"))
  baseline <- results$full
  lod <- results[names(results) != "full"]
  lfc <- do.call(cbind, lapply(lod, function(x) x$log2FoldChange[match(baseline$gene_id, x$gene_id)]))
  pv <- do.call(cbind, lapply(lod, function(x) x$padj[match(baseline$gene_id, x$gene_id)]))
  sensitivity <- data.frame(gene_id = baseline$gene_id, symbol = baseline$symbol,
                            full_log2FoldChange = baseline$log2FoldChange, full_padj = baseline$padj,
                            finite_lodo = rowSums(is.finite(lfc)),
                            matching_direction = rowSums(sign(lfc) == sign(baseline$log2FoldChange), na.rm = TRUE),
                            significant_lodo = rowSums(pv < 0.05, na.rm = TRUE),
                            min_lodo_log2FoldChange = apply(lfc, 1L, function(x) if (all(is.na(x))) NA_real_ else min(x, na.rm = TRUE)),
                            max_lodo_log2FoldChange = apply(lfc, 1L, function(x) if (all(is.na(x))) NA_real_ else max(x, na.rm = TRUE)))
  write_csv(sensitivity, file.path(out, "sensitivity.csv"))

  grDevices::pdf(file.path(out, "plots", "qc-and-response.pdf"), width = 9, height = 7,
                 onefile = TRUE, useDingbats = FALSE)
  full <- fitted$full
  DESeq2::plotMA(DESeq2::results(full, contrast = c("dex", "trt", "untrt"),
                               independentFiltering = FALSE, alpha = 0.05),
                alpha = 0.05, main = "Dexamethasone response, donor-adjusted")
  normalized <- DESeq2::counts(full, normalized = TRUE)
  mat <- log2(normalized + 1)
  pc <- stats::prcomp(t(mat), center = TRUE, scale. = FALSE)
  col <- ifelse(samples$dex == "trt", "#c54939", "#367bad")
  variance <- pc$sdev^2 / sum(pc$sdev^2)
  plot(pc$x[, 1L], pc$x[, 2L], col = col, pch = 19,
       xlab = sprintf("PC1 (%.1f%%)", 100 * variance[[1L]]),
       ylab = sprintf("PC2 (%.1f%%)", 100 * variance[[2L]]),
       main = "Sample QC: PCA of log2(normalized count + 1)")
  text(pc$x[, 1L], pc$x[, 2L], labels = samples$cell, pos = 3, cex = 0.75)
  legend("topright", legend = c("untreated", "dexamethasone"), col = c("#367bad", "#c54939"), pch = 19)
  selected_genes <- which(baseline$symbol %in% known)
  graphics::par(mfrow = c(2, 3))
  for (j in selected_genes) {
    vals <- normalized[j, ]
    plot(as.integer(samples$dex), vals, log = "y", pch = 19, col = col, xaxt = "n",
         xlim = c(0.8, 2.2), xlab = "", ylab = "Normalized counts", main = baseline$symbol[[j]])
    axis(1, at = 1:2, labels = c("untrt", "trt"))
    for (donor in donors) {
      idx <- which(samples$cell == donor)
      idx <- idx[order(samples$dex[idx])]
      lines(as.integer(samples$dex[idx]), vals[idx], col = "grey60")
    }
  }
  grDevices::dev.off()

  # Parametric bootstrap asks about estimator variability conditional on the fitted
  # eight-sample NB model. It neither resamples donors nor invents new biological data.
  mu <- SummarizedExperiment::assay(full, "mu")
  disp <- DESeq2::dispersions(full)
  stopifnot(identical(rownames(mu), baseline$gene_id), identical(colnames(mu), samples$sample_id),
            all(is.finite(mu)), all(mu > 0), all(is.finite(disp)), all(disp > 0))
  marker_idx <- match(known, baseline$symbol)
  stopifnot(!anyNA(marker_idx), !anyDuplicated(marker_idx))
  write_csv(data.frame(gene_id = rownames(mu), mu, check.names = FALSE),
            file.path(out, "bootstrap", "means.csv"))
  write_csv(data.frame(gene_id = rownames(mu), dispersion = disp),
            file.path(out, "bootstrap", "dispersion.csv"))
  bootstrap_plan <- list(schema_version = 1L, replicates = bootstrap_replicates,
                         seed = 52778L, rng_kind = as.list(RNGkind()),
                         generator = "stats::rnbinom", parameterization = "mu=full fitted mean, size=1/full fitted dispersion",
                         variance = "mu + dispersion * mu^2", samples = samples$sample_id,
                         fitted_genes = nrow(mu), genes_per_replicate = nrow(mu),
                         design = "~ cell + dex", contrast = c("dex", "trt", "untrt"),
                         markers = known, estimator = "refit DESeq2 Wald/parametric/ratio/betaPrior=FALSE",
                         independent_filtering = FALSE, cook_policy = "DESeq2 default", p_adjust_method = "BH",
                         quantile_probabilities = c(0.025, 0.5, 0.975), quantile_type = 7L,
                         scope = "Conditional fitted-model sampling distribution with fixed donors and independent gene simulation; not a population or clinical confidence interval")
  write_json(bootstrap_plan, file.path(out, "bootstrap", "plan.json"))
  boot_stats <- vector("list", bootstrap_replicates)
  boot_markers <- vector("list", bootstrap_replicates)
  boot_counts <- vector("list", bootstrap_replicates)
  set.seed(52778L)
  progress("bootstrap_started", replicates = bootstrap_replicates, genes = nrow(mu), seed = 52778L)
  for (replicate in seq_len(bootstrap_replicates)) {
    elapsed <- system.time({
      simulated <- matrix(stats::rnbinom(length(mu), mu = as.vector(mu),
                                          size = rep(1 / disp, times = ncol(mu))),
                          nrow = nrow(mu), ncol = ncol(mu), dimnames = dimnames(mu))
      if (replicate == 1L) {
        write_csv(data.frame(gene_id = rownames(simulated), simulated, check.names = FALSE),
                  file.path(out, "bootstrap", "first-simulated-counts.csv"))
      }
      simulated_hash <- digest::digest(paste(as.vector(simulated), collapse = ","), algo = "sha256", serialize = FALSE)
      boot <- DESeq2::DESeqDataSetFromMatrix(simulated, samples, design = ~ cell + dex)
      boot <- DESeq2::DESeq(boot, test = "Wald", fitType = "parametric", sfType = "ratio",
                            betaPrior = FALSE, parallel = FALSE, quiet = TRUE)
      br <- DESeq2::results(boot, contrast = c("dex", "trt", "untrt"), test = "Wald",
                           independentFiltering = FALSE, pAdjustMethod = "BH", alpha = 0.05,
                           parallel = FALSE)
      z <- data.frame(replicate = replicate, gene_id = rownames(br)[marker_idx],
                      symbol = baseline$symbol[marker_idx], as.data.frame(br)[marker_idx, , drop = FALSE],
                      beta_converged = S4Vectors::mcols(boot)$betaConv[marker_idx],
                      max_cooks = S4Vectors::mcols(boot)$maxCooks[marker_idx], check.names = FALSE)
      boot_markers[[replicate]] <- z
      boot_counts[[replicate]] <- data.frame(replicate = replicate,
                                             gene_id = rownames(simulated)[marker_idx],
                                             symbol = baseline$symbol[marker_idx],
                                             simulated[marker_idx, , drop = FALSE], check.names = FALSE)
      boot_stats[[replicate]] <- data.frame(replicate = replicate, n_genes = nrow(boot), n_samples = ncol(boot),
                                            simulated_counts_sum = sum(simulated), simulated_counts_sha256 = simulated_hash,
                                            tested_pvalues = sum(is.finite(br$pvalue)),
                                            missing_pvalues = sum(!is.finite(br$pvalue)),
                                            significant_genes = sum(br$padj < 0.05, na.rm = TRUE),
                                            unconverged_genes = sum(!S4Vectors::mcols(boot)$betaConv, na.rm = TRUE))
    })
    boot_stats[[replicate]]$elapsed_seconds <- unname(elapsed[["elapsed"]])
    progress("bootstrap_replicate_completed", replicate = replicate, total = bootstrap_replicates,
             elapsed_seconds = unname(elapsed[["elapsed"]]),
             missing_pvalues = boot_stats[[replicate]]$missing_pvalues,
             unconverged_genes = boot_stats[[replicate]]$unconverged_genes)
    # Preserve bounded partial progress without retaining each full fitted object.
    write_csv(do.call(rbind, boot_stats[seq_len(replicate)]), file.path(out, "bootstrap", "replicates.csv"))
    write_csv(do.call(rbind, boot_markers[seq_len(replicate)]), file.path(out, "bootstrap", "markers.csv"))
    write_csv(do.call(rbind, boot_counts[seq_len(replicate)]), file.path(out, "bootstrap", "marker-counts.csv"))
    rm(boot, br, simulated)
  }
  boot_rows <- do.call(rbind, boot_markers)
  bootstrap_summary <- do.call(rbind, lapply(known, function(symbol) {
    z <- boot_rows[boot_rows$symbol == symbol, , drop = FALSE]
    valid <- is.finite(z$log2FoldChange) & z$beta_converged %in% TRUE
    x <- z$log2FoldChange[valid]
    qs <- if (length(x)) stats::quantile(x, c(0.025, 0.5, 0.975), type = 7L, names = FALSE) else rep(NA_real_, 3L)
    data.frame(gene_id = unique(z$gene_id), symbol = symbol, full_log2FoldChange = baseline$log2FoldChange[match(symbol, baseline$symbol)],
               requested_replicates = bootstrap_replicates, finite_converged = length(x),
               excluded_lfc_or_convergence = nrow(z) - length(x), missing_pvalues = sum(!is.finite(z$pvalue)),
               positive_count = sum(x > 0), negative_count = sum(x < 0), zero_count = sum(x == 0),
               positive_fraction = if (length(x)) mean(x > 0) else NA_real_,
               q025 = qs[[1L]], q50 = qs[[2L]], q975 = qs[[3L]], quantile_type = 7L)
  }))
  write_csv(bootstrap_summary, file.path(out, "bootstrap", "summary.csv"))
  grDevices::pdf(file.path(out, "bootstrap", "marker-distributions.pdf"), width = 10, height = 8, useDingbats = FALSE)
  graphics::par(mfrow = c(2, 3), mar = c(4, 4, 3, 1))
  for (symbol in known) {
    z <- boot_rows[boot_rows$symbol == symbol, , drop = FALSE]
    x <- z$log2FoldChange[is.finite(z$log2FoldChange) & z$beta_converged %in% TRUE]
    qs <- bootstrap_summary[bootstrap_summary$symbol == symbol, ]
    if (length(x)) {
      # nclass.FD requires at least two observations. One replicate is an
      # intentional, supported smoke run; retain its actual single value.
      hist(x, breaks = if (length(x) == 1L) 1L else "FD", col = "#b9d3e8", border = "white", xlab = "Estimated log2 fold change",
           main = paste0(symbol, " (", length(x), " valid)"))
      abline(v = qs$full_log2FoldChange, col = "#c54939", lwd = 2)
      abline(v = c(qs$q025, qs$q975), lty = 2, col = "#367bad")
    } else {
      plot.new(); title(main = paste0(symbol, ": no valid fits"))
    }
  }
  grDevices::dev.off()

  utils::capture.output(utils::sessionInfo(), file = file.path(out, "sessionInfo.txt"))
  loaded <- sort(loadedNamespaces())
  versions <- data.frame(package = loaded,
                         version = vapply(loaded, function(p) as.character(utils::packageVersion(p)), ""),
                         library_path = vapply(loaded, find.package, ""))
  write_csv(versions, file.path(out, "versions.csv"))
  script_arg <- grep("^--file=", commandArgs(), value = TRUE)
  script_path <- if (length(script_arg) == 1L) sub("^--file=", "", script_arg) else NA_character_
  # Rscript encodes spaces in its --file argument as ~+~. Preserve literal
  # paths when they already exist; otherwise decode the native argument.
  if (!is.na(script_path) && !file.exists(script_path)) script_path <- gsub("~+~", " ", script_path, fixed = TRUE)
  script_sha <- if (!is.na(script_path) && file.exists(script_path)) digest::digest(file = script_path, algo = "sha256") else NA_character_
  summary <- list(schema_version = 1L, analysis = "airway paired dexamethasone response",
                  dataset = list(package = "airway", version = as.character(utils::packageVersion("airway")),
                                 geo_accession = "GSE52778", publication_doi = "10.1371/journal.pone.0099625",
                                 genes = nrow(cts), samples = ncol(cts), donors = donors,
                                 counts_sum = sum(cts), prefilter_kept = sum(keep)),
                  method = list(design = "~ cell + dex", contrast = c("dex", "trt", "untrt"),
                                test = "Wald", fit_type = "parametric", sf_type = "ratio", beta_prior = FALSE,
                                prefilter = "count >= 10 in >= 4 of original 8 samples; fixed gene universe",
                                independent_filtering = FALSE, cook_policy = "DESeq2 default",
                                p_adjust_method = "BH", alpha = 0.05, sensitivity = "leave one donor pair out, four fits",
                                seed = 52778L, parallel = FALSE,
                                bootstrap = list(replicates = bootstrap_replicates, seed = 52778L,
                                                 rng_kind = as.list(RNGkind()), generator = "stats::rnbinom",
                                                 scope = bootstrap_plan$scope)),
                  session = list(pid = Sys.getpid(), R = R.version.string, platform = R.version$platform,
                                 script_sha256 = script_sha, started_at = format(started, "%Y-%m-%dT%H:%M:%OS3%z", tz = "UTC"),
                                 completed_at = stamp(), elapsed_seconds = as.numeric(difftime(Sys.time(), started, units = "secs"))),
                  facts = list(full_significant = sum(baseline$padj < 0.05, na.rm = TRUE),
                               full_tested_pvalues = sum(is.finite(baseline$pvalue)),
                               full_unconverged = sum(!baseline$beta_converged, na.rm = TRUE),
                               known_genes_observed = unique(as.character(known_rows$symbol))),
                  interpretation = "Public-data reanalysis of four cultured donor cell lines; donor sensitivity is descriptive and bootstrap uncertainty is conditional on the fitted NB model, not new replication, donor-population or clinical evidence.")
  write_json(summary, file.path(out, "summary.json"))
  files <- sort(list.files(out, recursive = TRUE, full.names = TRUE, all.files = FALSE))
  files <- files[!dir.exists(files)]
  manifest <- data.frame(path = substring(files, nchar(out) + 2L),
                         bytes = as.numeric(file.info(files)$size),
                         sha256 = vapply(files, function(p) digest::digest(file = p, algo = "sha256"), ""))
  write_csv(manifest, file.path(out, "artifact_manifest.csv"))
  write_json(list(schema_version = 1L, state = "complete", completed_at = stamp(),
                  summary_sha256 = digest::digest(file = file.path(out, "summary.json"), algo = "sha256"),
                  manifest_sha256 = digest::digest(file = file.path(out, "artifact_manifest.csv"), algo = "sha256")),
             file.path(out, "complete.json"))
  progress("complete", output_directory = out, elapsed_seconds = summary$session$elapsed_seconds)
}

tryCatch(main(), error = function(e) {
  try(write_json(list(state = "failed", at = stamp(), error = conditionMessage(e)),
                 file.path(out, "failure.json")), silent = TRUE)
  message("analysis failed: ", conditionMessage(e))
  quit(status = 1L, save = "no")
})
