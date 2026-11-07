rho_adapter <- function(object, show_category) {
  if (!inherits(object, "phylo")) stop("The ggtree adapter currently accepts one phylo object saved as RDS.")
  if (length(object$tip.label) > 200L) stop("This figure view is limited to 200 tips; the original tree is unchanged.")
  if (anyNA(object$tip.label) || any(!nzchar(object$tip.label)) || anyDuplicated(object$tip.label)) stop("Tip labels must be present and unique; no ambiguous clade identity was assigned.")
  ntip <- length(object$tip.label); nodes <- seq_len(ntip + object$Nnode)
  descendants <- function(node) {
    if (node <= ntip) return(node)
    unlist(lapply(object$edge[object$edge[, 1] == node, 2], descendants), use.names = FALSE)
  }
  tips <- lapply(nodes, descendants)
  keys <- vapply(tips, function(ids) paste0("clade:", digest::digest(sort(object$tip.label[ids]), algo = "sha256")), "")
  if (anyDuplicated(keys)) stop("This tree has unary nodes with indistinguishable tip sets; capture needs an explicit node identity.")
  entities <- lapply(nodes, function(node) list(key = keys[node], kind = if (node <= ntip) "tip" else "clade",
    label = if (node <= ntip) object$tip.label[node] else paste0("Clade of ", length(tips[[node]]), " tips"),
    members = as.list(object$tip.label[tips[[node]]]),
    related = as.list(keys[vapply(tips, function(ids) all(ids %in% tips[[node]]), TRUE)]),
    attributes = list(nodeInSnapshot = node, tipCount = length(tips[[node]]))))
  plots <- lapply(c("rectangular", "circular"), function(layout) {
    p <- ggtree::ggtree(object, layout = layout) + ggtree::geom_tiplab(size = 3, align = FALSE)
    p <- p + ggplot2::xlim(0, max(p$data$x) * 1.45)
    p <- p + ggplot2::geom_point(ggplot2::aes(x = x, y = y), data = p$data, inherit.aes = FALSE, shape = 19, size = 2.4, colour = "#497181")
    p <- rho_points(p, length(p$layers), keys[p$data$node], p$data)
    rendered <- rho_svg(p, 9, 6.2)
    list(id = layout, title = if (layout == "rectangular") "Rectangular" else "Circular", svg = rendered$svg, boundMarks = rendered$boundMarks)
  })
  list(entities = entities, plots = plots, notes = list("Click a node to select its descendant tips. Both layouts come from the same captured tree.", "Branch lengths retain the input tree's units. A selected clade does not establish a biological interpretation."))
}
