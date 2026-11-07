rho_adapter <- function(object, show_category) {
  if (!inherits(object, "enrichResult")) stop("Select an enrichResult saved from clusterProfiler (ORA). GSEA and compareCluster need their own adapters.")
  results <- as.data.frame(object)
  required <- c("ID", "Description", "geneID", "p.adjust", "Count", "GeneRatio")
  if (!all(required %in% names(results)) || !nrow(results)) stop("No visible enrichment results. Check the result object's cutoffs and analysis.")
  if (anyNA(results$ID) || anyDuplicated(results$ID)) stop("Enriched term IDs must be unique.")
  shown <- head(results, show_category)
  if (anyDuplicated(shown$Description)) stop("Selected terms have duplicate descriptions; explicit network node IDs are required before binding them.")
  term_keys <- paste0("term:", shown$ID)
  memberships <- strsplit(as.character(shown$geneID), "/", fixed = TRUE)
  genes <- unique(unlist(memberships))
  if (length(genes) > 150L) stop("The network view is limited to 150 genes. Select fewer categories; earlier figures are retained.")
  if (any(genes %in% shown$Description)) stop("A gene identifier collides with a term label; the native network is ambiguous.")
  entities <- lapply(seq_len(nrow(shown)), function(i) list(key = term_keys[i], kind = "term", label = as.character(shown$Description[i]),
    members = as.list(memberships[[i]]), related = as.list(c(term_keys[i], paste0("gene:", memberships[[i]]))),
    attributes = list(ID = as.character(shown$ID[i]), adjustedP = shown$p.adjust[i], geneRatio = as.character(shown$GeneRatio[i]), count = shown$Count[i])))
  entities <- c(entities, lapply(genes, function(gene) {
    indices <- which(vapply(memberships, function(m) gene %in% m, TRUE))
    list(key = paste0("gene:", gene), kind = "gene", label = gene, members = as.list(shown$ID[indices]),
      related = as.list(c(paste0("gene:", gene), term_keys[indices])), attributes = list(termsShown = length(indices)))
  }))
  dot <- enrichplot::dotplot(object, showCategory = as.character(shown$Description), font.size = 11)
  if (!"ID" %in% names(dot$data) || anyNA(match(dot$data$ID, shown$ID))) stop("The native dotplot did not retain term IDs.")
  for (i in seq_along(dot$layers)) if (inherits(dot$layers[[i]]$geom, "GeomPoint")) dot <- rho_points(dot, i, paste0("term:", dot$data$ID), dot$data)
  dot <- dot + ggplot2::theme(plot.margin = ggplot2::margin(15, 25, 15, 15))
  set.seed(47)
  net <- enrichplot::cnetplot(object, showCategory = as.character(shown$Description), node_label = "all", color_category = "#317a82", color_item = "#b8c7d2")
  if (!all(c("name", ".isCategory") %in% names(net$data))) stop("The installed cnetplot version does not expose typed native nodes.")
  for (i in seq_along(net$layers)) {
    layer <- net$layers[[i]]
    if (!inherits(layer$geom, "GeomPoint")) next
    data <- if (is.function(layer$data)) layer$data(net$data) else if (is.data.frame(layer$data)) layer$data else net$data
    keys <- ifelse(data$.isCategory, term_keys[match(data$name, shown$Description)], paste0("gene:", data$name))
    if (anyNA(keys) || any(!keys %in% vapply(entities, `[[`, "", "key"))) stop("A network node has no unambiguous entity binding.")
    net <- rho_points(net, i, keys, data)
  }
  net <- net + ggplot2::theme(plot.margin = ggplot2::margin(20, 30, 20, 30))
  a <- rho_svg(dot, 7.5, 5.4); b <- rho_svg(net, 8, 5.4)
  list(entities = entities, plots = list(list(id = "dotplot", title = "Enriched terms", svg = a$svg, boundMarks = a$boundMarks),
    list(id = "cnetplot", title = "Terms and their genes", svg = b$svg, boundMarks = b$boundMarks)),
    notes = list(paste0(nrow(shown), " of ", nrow(results), " visible terms; ", length(genes), " genes. Selections refer only to these displayed terms."),
      "Both plots use the same captured enrichment result. Gene membership is read from the result, not inferred from network proximity."),
    analysis = list(organism = object@organism, ontology = object@ontology, keytype = object@keytype, readable = object@readable,
      pAdjustMethod = object@pAdjustMethod, pvalueCutoff = object@pvalueCutoff, qvalueCutoff = object@qvalueCutoff,
      universeSize = length(object@universe), inputGeneCount = length(object@gene), displayedTerms = as.list(shown$ID)))
}
