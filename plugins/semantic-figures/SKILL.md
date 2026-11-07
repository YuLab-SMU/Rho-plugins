---
name: semantic-figures
description: Select a clade in ggtree layouts, or follow terms and genes across native enrichplot dotplot and cnetplot figures in a Rho project.
---

Read the installed plugin's schema and use its operations through extension.call.
The adapter renders original R graphics and attaches explicit point bindings.
It does not infer scientific meaning, reconstruct arbitrary SVG, or run enrichment.

1. Save the intended `phylo` or `enrichResult` as an ordinary RDS in the project.
   Record the analysis, annotation database and identifier namespace with the source.
2. `capture` with `adapter: ggtree` or `enrichplot` and the project-relative source.
   It copies the source and submits one cell to the shared local R session. Observe
   that original cell with `cell`; missing acknowledgement never means rerun.
3. `list` and `read` retrieve retained figures without starting R. `read` reports
   whether the original source changed. The figure still names its captured bytes.
4. `selection` reads exact selected entities, members and source snapshot. Use this
   for questions about a selection; do not guess identities from screen positions.
   `select` requires the current figure digest and selection revision. A conflict
   needs a fresh read and a deliberate choice, not an automatic overwrite.

Tree selections use descendant tip sets within one tree snapshot. Layout changes
keep the same snapshot. This first adapter does not transfer selections across a
changed topology. Enrichment selections use term IDs and the result's geneID
membership. Networks show only the selected top categories; no edge implies a
causal relationship. The adapter supports ORA enrichResult, not GSEA or
compareClusterResult. Duplicate tip labels, ambiguous network labels and changed
native point structure fail rather than guessing. Model interpretation remains a
separate statement from point binding or statistical validity.

Prerequisites: local R, ggplot2, svglite, xml2, jsonlite, digest; ggtree and ape for
trees, enrichplot for enrichment. Packages are not installed by the plugin.
Reads and selection changes do not start R. See README for resource limits and
the browser episode for observed behavior and remaining work.
