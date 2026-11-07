# Episode inputs, deliberately outside the reusable plugin package.
# Usage: Rscript prepare.R PROJECT [EXISTING_EPISODE_R_LIBRARY]
args <- commandArgs(trailingOnly = TRUE)
stopifnot(length(args) >= 1L)
project <- normalizePath(args[[1]], mustWork = TRUE)
if (length(args) > 1L) .libPaths(c(normalizePath(args[[2]], mustWork = TRUE), .libPaths()))
needed <- c("ape", "clusterProfiler", "DOSE", "org.Hs.eg.db")
missing <- needed[!vapply(needed, requireNamespace, TRUE, quietly = TRUE)]
if (length(missing)) stop("Missing episode prerequisites: ", paste(missing, collapse = ", "))
dir.create(file.path(project, "data"), showWarnings = FALSE)
dir.create(file.path(project, "results"), showWarnings = FALSE)
data("bird.orders", package = "ape")
saveRDS(bird.orders, file.path(project, "data", "bird-orders.rds"))
data("geneList", package = "DOSE")
genes <- names(geneList)[geneList > 2]
result <- clusterProfiler::enrichGO(gene = genes, universe = names(geneList),
  OrgDb = org.Hs.eg.db::org.Hs.eg.db, keyType = "ENTREZID", ont = "BP",
  minGSSize = 10, maxGSSize = 100, pAdjustMethod = "BH", pvalueCutoff = .05,
  qvalueCutoff = .2, readable = FALSE)
if (is.null(result) || nrow(as.data.frame(result)) < 3L) stop("This input did not yield three visible GO terms; inspect the result before changing the episode.")
saveRDS(result, file.path(project, "results", "go-bp.rds"))
saveRDS(list(not_a_tree = TRUE), file.path(project, "data", "not-a-tree.rds"))
utils::write.csv(as.data.frame(result), file.path(project, "results", "go-bp.csv"), row.names = FALSE)
writeLines(c("Demonstration inputs; this episode tests selection and linking, not a biological hypothesis.",
  "Tree: ape::bird.orders, Sibley and Ahlquist bird-order phylogeny distributed with ape.",
  "Enrichment: DOSE::geneList; select positive values > 2, use all named genes as the declared background.",
  "GO BP; ENTREZID; gene set sizes 10–100; BH; pvalueCutoff 0.05; qvalueCutoff 0.2.",
  paste("Input genes:", length(genes), "Background:", length(geneList), "Visible terms:", nrow(as.data.frame(result))),
  capture.output(utils::sessionInfo())), file.path(project, "results", "provenance.txt"))
cat("Prepared ", length(bird.orders$tip.label), " tree tips and ", nrow(as.data.frame(result)), " enriched terms in ", project, "\n", sep = "")
