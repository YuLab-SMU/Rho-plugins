# Semantic figures for a live R session. The Notebook's runner sources this file into an
# environment of its own and calls three functions:
#
#   page_object()   when a grid page starts on the session's recording device: the plot object
#                   being drawn there, if a describer knows how to find it (NULL otherwise);
#   saved_page()    when a page starts on another device: the plot, the file it is being saved to
#                   and the page's size in inches, if a describer knows them (NULL otherwise);
#   describe_page(object, file, width, height, into, recorded)
#                   after that page's picture is written to `file`: writes the figure record
#                   (by default beside it, <file without .png>.figure.json) and returns a short
#                   summary. `object` is what page_object() named, or the recorded page itself
#                   when it named nothing; `recorded` is the page as recordPlot() kept it.
#
# A describer recognizes one kind of plot and binds what it draws to the data behind it. ggplot2's
# describes any plot built on ggplot2 layers (ggtree, enrichplot, Seurat, ggpubr, survminer and the
# rest) from its own layers and data, with no package-specific code. A page drawn with base
# graphics is described from what it drew: each point, label, bar or line keeps the values it was
# drawn at, and is bound to a table of the session only where those values are the table's own.
# A ComplexHeatmap is described from its laid-out heatmap: each cell names its row, its column
# and its value. Nothing here guesses a role from pixels.
#
# A describer never changes the session: printed output, warnings and messages are discarded,
# the random number stream is restored, and a failure leaves the page as a picture with the
# reason. The protected resources are the session's time and the state folder: a description
# stops after maxSeconds, refuses more than maxMarks drawn marks and writes at most maxBytes.
# A volcano of every gene with a p-value (22,415 marks with its labels) took 2.8 s and 7.8 MB.
limits <- list(maxMarks = 30000L, maxColumns = 40L, maxCellChars = 160L, maxSeconds = 20, maxBytes = 16L * 1024L * 1024L,
  maxTables = 64L, maxTableCells = 5e6)
schema <- "rho.figure/1"
`%||%` <- function(a, b) if (is.null(a)) b else a

# ggplot2 ----------------------------------------------------------------------------------------
# print() of a ggplot names the plot as the last one and then starts the page, so the plot being
# drawn is the `x` of the print method's frame on the stack when the page starts.
ggplot_print_methods <- function() {
  if (!isNamespaceLoaded("ggplot2")) return(list())
  Filter(Negate(is.null), list(
    utils::getS3method("print", "ggplot2::ggplot", optional = TRUE),
    utils::getS3method("print", "ggplot", optional = TRUE),
    if (isNamespaceLoaded("patchwork")) utils::getS3method("print", "patchwork", optional = TRUE)))
}
ggplot_object <- function() {
  methods <- ggplot_print_methods()
  if (!length(methods)) return(NULL)
  n <- sys.nframe()
  for (i in rev(seq_len(n))) {
    f <- sys.function(i)
    for (m in methods) if (identical(f, m)) {
      x <- tryCatch(get("x", envir = sys.frame(i), inherits = FALSE), error = function(e) NULL)
      if (inherits(x, "ggplot")) return(x)
    }
  }
  NULL
}
# ggsave() opens a device for its file and draws the plot there: the page's plot is found as above,
# its file is ggsave's own (with its path already joined) and its size is the device's, whatever
# units, scale or dpi it was given.
saved_page <- function() {
  object <- ggplot_object()
  if (is.null(object)) return(NULL)
  save <- utils::getFromNamespace("ggsave", "ggplot2")
  for (i in rev(seq_len(sys.nframe()))) if (identical(sys.function(i), save)) {
    file <- get0("filename", envir = sys.frame(i), inherits = FALSE)
    if (!is.character(file) || length(file) != 1L || !nzchar(file)) return(NULL)
    size <- grDevices::dev.size("in")
    return(list(object = object, file = file, width = size[1], height = size[2]))
  }
  NULL
}

# A grid page names a ggplot being printed, or else a ComplexHeatmap being drawn (see below). A
# page drawn with base graphics names nothing: it is described from its recording.
page_object <- function() ggplot_object() %||% heatmap_frame()

# Each layer's geom is wrapped so that what it draws in each panel carries the plot, the layer, the
# panel and the built rows it drew: a built row is numbered as it reaches the geom (handle_na sees
# the layer's whole built data), so this holds whoever builds the plot, ggplot2 or patchwork.
# ggproto objects are environments: layers and geoms are cloned, never changed, so the person's
# own plot object stays as it was.
tag_layer <- function(layer, plot, index) {
  force(plot); force(index); original <- layer$geom
  geom <- ggplot2::ggproto(NULL, original,
    handle_na = function(self, data, params) {
      data$.rho_mark <- seq_len(nrow(data))
      ggplot2::ggproto_parent(original, self)$handle_na(data, params)
    },
    draw_layer = function(self, data, params, layout, coord) {
      grobs <- ggplot2::ggproto_parent(original, self)$draw_layer(data, params, layout, coord)
      panels <- if (nlevels(as.factor(data$PANEL)) > 1L) split(data, data$PANEL) else list(data)
      for (k in seq_along(grobs)) {
        d <- panels[[k]]
        if (is.null(d) || !nrow(d) || is.null(grobs[[k]]) || inherits(grobs[[k]], "zeroGrob") || is.null(d$.rho_mark)) next
        grobs[[k]]$rho_tag <- list(plot = plot, layer = index, panel = as.integer(as.character(d$PANEL[1])), mark = d$.rho_mark, group = d$group %||% rep(-1L, nrow(d)),
          label = if (!is.null(d$label) && !is.list(d$label)) as.character(d$label) else NULL)
      }
      grobs
    })
  out <- ggplot2::ggproto(NULL, layer); out$geom <- geom
  out
}

# Every layer whose data is a table gets a row number as an extra aesthetic. A stat that keeps
# its input rows (identity, ggtree's, most label stats) carries it through to the drawn marks;
# one that computes new rows (bins, densities, boxes) drops it, and those marks name the
# computed values instead.
prepare <- function(p, plot) {
  sources <- list(); keys <- character(length(p$layers))
  for (i in seq_along(p$layers)) {
    original <- p$layers[[i]]
    layer <- tag_layer(original, plot, i)
    d <- tryCatch(original$layer_data(p$data), error = function(e) NULL)
    if (is.data.frame(d) && nrow(d)) {
      # layer_data() drops row names (cell barcodes, gene IDs); the rows keep their order.
      raw <- if (inherits(original$data, "waiver")) p$data else if (is.function(original$data)) tryCatch(original$data(p$data), error = function(e) NULL) else original$data
      if (is.data.frame(raw) && nrow(raw) == nrow(d) && .row_names_info(raw) > 0L) rownames(d) <- rownames(raw)
      own <- !inherits(original$data, "waiver")
      key <- paste0(if (plot > 1L) paste0("plot", plot, ".") else "", if (own) paste0("layer", i) else "data")
      if (is.null(sources[[key]])) sources[[key]] <- d
      d$.rho_row <- seq_len(nrow(d))
      layer$data <- d
      m <- if (is.null(original$mapping)) ggplot2::aes() else original$mapping
      m[[".rho_row"]] <- ggplot2::aes(.rho_row = .rho_row)[[1]]
      layer$mapping <- m
      keys[i] <- key
    }
    p$layers[[i]] <- layer
  }
  list(plot = p, sources = sources, keys = keys)
}

# One unit is a set of drawn elements that stand for some built rows of one layer in one panel:
# each element one row (points, rectangles, labels, segments), or one group (a line, a polygon,
# a box). What cannot be matched one to one is left drawn and reported, never guessed.
primitive_count <- function(x) {
  if (inherits(x, "text")) return(length(x$label))
  if (inherits(x, "segments")) return(length(x$x0))
  if (inherits(x, c("points", "rect", "circle"))) return(max(length(x$x), length(x$y)))
  NA_integer_
}
texts_in <- function(g) if (inherits(g, "text")) as.character(g$label) else if (inherits(g, "gTree")) unlist(lapply(g$children, texts_in), use.names = FALSE) else character()
units_of <- function(grob) {
  tag <- grob$rho_tag
  groups <- sort(unique(tag$group)); n <- length(tag$mark)
  of_group <- function(g) tag$mark[tag$group == g]
  k <- primitive_count(grob)
  if (!is.na(k)) {
    if (k == n) return(list(list(grob = grob, marks = as.list(tag$mark), each = TRUE)))
    return(list(list(grob = grob, reason = sprintf("draws %d elements for %d rows", k, n))))
  }
  if (inherits(grob, c("polyline", "polygon", "pathgrob", "lines"))) {
    ids <- grob$id %||% grob$pathId
    if (!is.null(ids) && length(unique(ids)) == length(groups)) return(list(list(grob = grob, marks = lapply(groups, of_group), each = TRUE)))
    if (length(groups) == 1L) return(list(list(grob = grob, marks = list(tag$mark), each = TRUE)))
    return(list(list(grob = grob, reason = sprintf("draws one shape for %d groups", length(groups)))))
  }
  if (inherits(grob, "gTree") && length(grob$children)) {
    kids <- length(grob$children)
    # Labels drawn with halos or leader lines (ggrepel) draw several parts per row: a part whose
    # text is one row's label stands for that row; the lines between stay drawn, unbound.
    if (!is.null(tag$label) && length(tag$label) == n && !anyDuplicated(tag$label)) {
      owner <- vapply(grob$children, function(ch) { t <- unique(texts_in(ch)); if (length(t) == 1L && t %in% tag$label) t else NA_character_ }, "")
      if (all(tag$label %in% owner)) return(lapply(seq_len(kids), function(j) if (is.na(owner[j])) list(grob = grob$children[[j]], quiet = TRUE, child = TRUE)
        else list(grob = grob$children[[j]], marks = list(tag$mark[match(owner[j], tag$label)]), each = TRUE, child = TRUE)))
    }
    if (kids == n && length(groups) != n) return(lapply(seq_len(kids), function(j) list(grob = grob$children[[j]], marks = list(tag$mark[j]), each = TRUE, child = TRUE)))
    if (kids %% length(groups) == 0L) {
      per <- kids / length(groups)
      return(lapply(seq_len(kids), function(j) list(grob = grob$children[[j]], marks = list(of_group(groups[(j - 1L) %/% per + 1L])), each = TRUE, child = TRUE)))
    }
    return(list(list(grob = grob, reason = sprintf("draws %d parts for %d groups", kids, length(groups)))))
  }
  list(list(grob = grob, reason = sprintf("draws a %s", class(grob)[1])))
}

# `gt` is the page as a grob, or a function that draws it and returns it; `tag` marks the parts of
# the forced page that stand for marks.
render <- function(gt, width, height, tag = identity) {
  capture <- svglite::svgstring(width, height, standalone = TRUE, web_fonts = list())
  open <- TRUE
  on.exit(if (open) grDevices::dev.off(), add = TRUE)
  grob <- tag(grid::grid.force(if (is.function(gt)) gt() else gt))
  units <- list(); unbound <- list()
  wrap <- function(x) {
    if (!is.null(x$rho_tag)) {
      parts <- units_of(x)
      made <- lapply(parts, function(u) {
        if (is.null(u$marks) && isTRUE(u$quiet)) return(u$grob)
        if (is.null(u$marks)) { unbound[[length(unbound) + 1L]] <<- list(plot = x$rho_tag$plot, layer = x$rho_tag$layer, panel = x$rho_tag$panel, reason = u$reason); return(u$grob) }
        units[[length(units) + 1L]] <<- list(plot = x$rho_tag$plot, layer = x$rho_tag$layer, panel = x$rho_tag$panel, marks = u$marks)
        g <- u$grob; vp <- g$vp; g$vp <- NULL
        grid::groupGrob(g, vp = vp, name = paste0("rho-unit-", length(units)))
      })
      if (!isTRUE(parts[[1]]$child)) return(made[[1]])
      return(grid::setChildren(x, do.call(grid::gList, made)))
    }
    if (inherits(x, "gTree") && length(x$children)) {
      order <- match(x$childrenOrder, names(x$children))
      if (anyNA(order)) stop("A drawn part's children cannot be put in their drawing order.")
      x$children <- do.call(grid::gList, lapply(x$children[order], wrap))
      x$childrenOrder <- names(x$children)
    }
    x
  }
  grid::grid.newpage(); grid::grid.draw(wrap(grob))
  grDevices::dev.off(); open <- FALSE
  list(svg = as.character(utils::tail(capture(), 1L)), units = units, unbound = unbound)
}

drawn <- ".//*[self::circle or self::rect or self::polygon or self::polyline or self::path or self::line or self::text]"
# Each element of a unit gets data-rho="unit.element" (both counted from 0), and the units' groups
# are put back where the device referenced them, keeping its transforms and clipping.
bind <- function(svg, units) {
  doc <- xml2::read_xml(svg); xml2::xml_ns_strip(doc)
  defs <- xml2::xml_find_all(doc, ".//defs/g[starts-with(@id, 'group-')]")
  problems <- character()
  if (length(defs) != length(units)) stop(sprintf("The picture has %d groups for %d bound units.", length(defs), length(units)))
  kept <- logical(length(units))
  for (i in seq_along(units)) {
    u <- units[[i]]; els <- xml2::xml_find_all(defs[[i]], drawn)
    n <- length(u$marks)
    if (!length(els) || length(els) %% n != 0L) { problems <- c(problems, sprintf("Layer %d drew %d elements for %d marks; they are not bound.", u$layer, length(els), n)); next }
    per <- length(els) / n
    for (j in seq_along(els)) xml2::xml_set_attr(els[[j]], "data-rho", paste0(i - 1L, ".", (j - 1L) %/% per))
    kept[i] <- TRUE
  }
  for (use in xml2::xml_find_all(doc, ".//use")) {
    ref <- sub("^#", "", xml2::xml_attr(use, "href") %||% xml2::xml_attr(use, "xlink:href"))
    idx <- which(xml2::xml_attr(defs, "id") == ref)
    if (length(idx) != 1L) next
    node <- xml2::xml_add_sibling(use, defs[[idx]], .copy = TRUE)
    xml2::xml_set_attr(node, "id", NA_character_)
    for (key in names(xml2::xml_attrs(use))) if (!key %in% c("href", "xlink:href")) xml2::xml_set_attr(node, key, xml2::xml_attr(use, key))
    xml2::xml_remove(use)
  }
  xml2::xml_remove(defs)
  # Namespaces were stripped to search the document; the picture is SVG again.
  xml2::xml_set_attr(xml2::xml_root(doc), "xmlns", "http://www.w3.org/2000/svg")
  list(svg = as.character(doc), kept = kept, problems = problems)
}

clip <- function(s, n = limits$maxCellChars) ifelse(!is.na(s) & nchar(s) > n, paste0(substr(s, 1, n - 1L), "…"), s)
# A column as JSON-ready values: numbers stay numbers, everything else is its printed text.
column <- function(v, rows) {
  v <- v[rows]
  if (is.factor(v)) v <- as.character(v)
  if (inherits(v, c("Date", "POSIXt"))) v <- format(v)
  if (is.list(v)) return(list(type = "list", values = I(vapply(v, function(e) paste0("<", class(e)[1], ">"), ""))))
  if (is.logical(v)) return(list(type = "logical", values = I(v)))
  if (is.numeric(v)) return(list(type = if (is.integer(v)) "integer" else "number", values = I(ifelse(is.finite(v), signif(v, 7), NA))))
  list(type = "text", values = I(clip(as.character(v))))
}
# A column whose values name each row once can follow a row across versions of the data.
key_column <- function(d) {
  if (.row_names_info(d) > 0L) return(".rownames")
  unique_ <- function(v) !anyNA(v) && !anyDuplicated(v)
  for (name in names(d)) if ((is.character(d[[name]]) || is.factor(d[[name]])) && unique_(d[[name]])) return(name)
  for (name in names(d)) if (is.numeric(d[[name]]) && grepl("^(node|id|.*[._]id|ID)$", name) && unique_(d[[name]])) return(name)
  NULL
}
table_of <- function(d, rows) {
  names_ <- utils::head(names(d)[!startsWith(names(d), ".rho")], limits$maxColumns)
  cols <- lapply(names_, function(n) c(list(name = n), column(d[[n]], rows)))
  if (.row_names_info(d) > 0L) cols <- c(list(c(list(name = ".rownames"), column(rownames(d), rows))), cols)
  list(rows = nrow(d), columnsTotal = ncol(d) - sum(startsWith(names(d), ".rho")), key = key_column(d), index = I(as.integer(rows) - 1L), columns = cols)
}

label_text <- function(x) if (is.null(x) || inherits(x, "waiver")) NULL else if (is.character(x)) paste(x, collapse = " ") else tryCatch(paste(deparse(x), collapse = " "), error = function(e) NULL)
mapping_text <- function(m) if (is.null(m) || !length(m)) list() else as.list(vapply(m, function(q) tryCatch(rlang::as_label(q), error = function(e) "?"), ""))
geom_name <- function(layer) sub("^Geom", "", class(layer$geom)[1])
stat_name <- function(layer) sub("^Stat", "", class(layer$stat)[1])

# A ggplot is one plot; a patchwork is its parts, each in turn, then itself, the last plot. A part
# may be a patchwork of its own (Seurat returns each plot as one), and one that is not a ggplot
# (a wrapped grob, a spacer) is drawn as it is, with nothing bound.
parts_of <- function(p) {
  if (!inherits(p, "patchwork")) return(list(p))
  c(unlist(lapply(p$patches$plots, function(x) if (inherits(x, "ggplot")) parts_of(x) else list()), recursive = FALSE), list(p))
}
# The same composition with each ggplot part replaced, in the order parts_of() named them.
with_parts <- function(p, parts) {
  k <- 0L
  swap <- function(x) {
    if (!inherits(x, "ggplot")) return(x)
    if (inherits(x, "patchwork")) for (j in seq_along(x$patches$plots)) x$patches$plots[[j]] <- swap(x$patches$plots[[j]])
    k <<- k + 1L
    main <- parts[[k]]
    if (inherits(x, "patchwork")) { main$patches <- x$patches }
    main
  }
  swap(p)
}

# Built positions are on the scale's transformed axis (log10 for scale_y_log10); a reader wants
# the data's own values, so positions are put back through the scale's inverse.
position_columns <- list(x = c("x", "xmin", "xmax", "xend", "xintercept", "xmin_final", "xmax_final", "xlower", "xmiddle", "xupper"),
  y = c("y", "ymin", "ymax", "yend", "yintercept", "lower", "middle", "upper", "ymin_final", "ymax_final", "notchupper", "notchlower"))
style_columns <- "^(colour|color|fill|size|alpha|shape|linetype|linewidth|stroke|fontface|family|fontsize|hjust|vjust|angle|lineheight|width|weight|point[.]size|point[.]colour|segment[.].*|label[.].*|bg[.].*|box[.]padding|point[.]padding|min[.]segment[.]length|arrow[.].*)$"
transform_of <- function(sc) {
  tr <- tryCatch(sc$get_transformation(), error = function(e) tryCatch(sc$trans, error = function(e) NULL))
  if (is.null(tr) || identical(tr$name, "identity") || !is.function(tr$inverse)) NULL else tr
}
describe_plot <- function(p, b, prep, plot, units, unbound, used) {
  scales_xy <- list(x = tryCatch(b$layout$panel_scales_x[[1]], error = function(e) NULL), y = tryCatch(b$layout$panel_scales_y[[1]], error = function(e) NULL))
  transforms <- lapply(scales_xy, function(sc) if (is.null(sc) || isTRUE(tryCatch(sc$is_discrete(), error = function(e) TRUE))) NULL else transform_of(sc))
  labels <- utils::modifyList(as.list(b$plot$labels %||% list()), as.list(p$labels %||% list()))
  layers <- list(); marks <- list()
  # A plot without layers (a spacer) is built with a blank one of ggplot2's own; it draws nothing.
  for (i in seq_len(min(length(b$data), length(p$layers)))) {
    d <- b$data[[i]]; layer <- p$layers[[i]]
    for (axis in c("x", "y")) if (!is.null(transforms[[axis]])) for (cn in intersect(names(d), position_columns[[axis]])) if (is.numeric(d[[cn]])) d[[cn]] <- suppressWarnings(transforms[[axis]]$inverse(d[[cn]]))
    linked <- !is.null(d$.rho_row) && is.numeric(d$.rho_row) && !anyNA(d$.rho_row)
    source <- if (linked && nzchar(prep$keys[i])) prep$keys[i] else NULL
    if (!is.null(source)) used[[source]] <- sort(unique(c(used[[source]], d$.rho_row)))
    keep <- setdiff(names(d), c(".rho_row", ".rho_mark", "PANEL", "group", "flipped_aes"))
    keep <- keep[vapply(d[keep], function(v) !all(is.na(v)) && !is.list(v), TRUE)]
    # Only a style the layer draws every mark in (one colour, one size) is told once for the layer;
    # a position or a computed value (a count, a density) stays with each mark even when equal.
    constant <- keep[grepl(style_columns, keep) & vapply(d[keep], function(v) nrow(d) > 1L && length(unique(v)) == 1L, TRUE)]
    varying <- utils::head(setdiff(keep, constant), limits$maxColumns)
    marks[[i]] <- list(panel = I(as.integer(as.character(d$PANEL))), group = I(as.integer(d$group %||% rep(-1L, nrow(d)))), row = if (!is.null(source)) I(as.integer(d$.rho_row) - 1L) else NULL,
      columns = lapply(varying, function(n) c(list(name = n), column(d[[n]], seq_len(nrow(d))))))
    mine <- vapply(units, function(u) u$plot == plot && u$layer == i, TRUE)
    lost <- Filter(function(u) u$plot == plot && u$layer == i, unbound)
    layers[[i]] <- list(plot = plot, layer = i, geom = geom_name(layer), stat = stat_name(layer), position = sub("^Position", "", class(layer$position)[1]),
      mapping = mapping_text(if (isTRUE(layer$inherit.aes)) utils::modifyList(as.list(p$mapping), as.list(layer$mapping %||% list())) else layer$mapping),
      constants = lapply(d[1, constant, drop = FALSE], function(v) if (is.numeric(v)) signif(v, 7) else as.character(v)),
      source = source, marks = nrow(d), units = sum(mine),
      bound = if (!any(mine)) "none" else if (all(vapply(units[mine], function(u) all(lengths(u$marks) == 1L), TRUE))) "mark" else "group",
      unbound = if (length(lost)) I(unique(vapply(lost, `[[`, "", "reason"))) else NULL)
  }
  facets <- b$layout$layout
  facet_vars <- setdiff(names(facets), c("PANEL", "ROW", "COL", "SCALE_X", "SCALE_Y", "COORD"))
  scales <- tryCatch(Filter(Negate(is.null), lapply(b$plot$scales$scales, function(sc) {
    aes <- sc$aesthetics
    if (any(aes %in% c("x", "y", "xmin", "xmax", "ymin", "ymax", "xend", "yend"))) return(NULL)
    br <- sc$get_breaks(); if (is.null(br) || !length(br) || all(is.na(br))) return(NULL)
    list(aesthetic = aes[1], title = label_text(labels[[aes[1]]]) %||% aes[1], breaks = I(as.character(sc$get_labels(br))), values = I(as.character(sc$map(br))))
  })), error = function(e) list())
  positions <- lapply(c(x = "x", y = "y"), function(a) tryCatch({
    sc <- if (a == "x") b$layout$panel_scales_x[[1]] else b$layout$panel_scales_y[[1]]
    tr <- transforms[[a]]
    if (sc$is_discrete()) list(discrete = TRUE, levels = I(as.character(sc$get_limits())))
    else c(list(discrete = FALSE, range = I(signif(if (is.null(tr)) sc$get_limits() else tr$inverse(sc$get_limits()), 7))), if (!is.null(tr)) list(transform = tr$name))
  }, error = function(e) NULL))
  list(used = used, layers = layers, marks = marks,
    plot = list(plot = plot, title = label_text(labels$title), subtitle = label_text(labels$subtitle), caption = label_text(labels$caption),
      labels = Filter(Negate(is.null), lapply(labels[setdiff(names(labels), c("title", "subtitle", "caption", "alt"))], label_text)),
      panels = lapply(seq_len(nrow(facets)), function(k) list(panel = as.integer(as.character(facets$PANEL[k])), facets = lapply(facets[k, facet_vars, drop = FALSE], as.character))),
      facet = sub("^Facet", "", class(b$layout$facet)[1]), coord = sub("^Coord", "", class(b$layout$coord)[1]), scales = scales, positions = positions))
}

describe_ggplot <- function(p, width, height, ...) {
  parts <- parts_of(p)
  preps <- lapply(seq_along(parts), function(k) prepare(parts[[k]], k))
  builds <- lapply(preps, function(x) ggplot2::ggplot_build(x$plot))
  total <- sum(vapply(builds, function(b) sum(vapply(b$data, nrow, 0L)), 0L))
  if (total > limits$maxMarks) stop(sprintf("The plot draws %d marks, more than the %d a figure binds.", total, limits$maxMarks))
  gt <- if (inherits(p, "patchwork")) patchwork::patchworkGrob(with_parts(p, lapply(preps, `[[`, "plot")))
    else ggplot2::ggplot_gtable(builds[[1]])
  r <- render(gt, width, height)
  s <- bind(r$svg, r$units)
  units <- r$units[s$kept]
  used <- list(); layers <- list(); marks <- list(); plots <- list(); sources <- list()
  for (k in seq_along(parts)) {
    one <- describe_plot(parts[[k]], builds[[k]], preps[[k]], k, units, r$unbound, used)
    used <- one$used; layers <- c(layers, one$layers); marks <- c(marks, one$marks); plots[[k]] <- one$plot
    for (key in names(preps[[k]]$sources)) sources[[length(sources) + 1L]] <- c(list(id = key), table_of(preps[[k]]$sources[[key]], used[[key]] %||% integer()))
  }
  index <- function(plot, layer) which(vapply(layers, function(l) l$plot == plot && l$layer == layer, TRUE)) - 1L
  title <- if (inherits(p, "patchwork")) label_text(p$patches$annotation$title) else NULL
  list(svg = s$svg, problems = I(s$problems),
    units = lapply(units, function(u) list(layer = index(u$plot, u$layer), panel = u$panel, marks = lapply(u$marks, function(m) I(as.integer(m) - 1L)))),
    figure = list(kind = if (inherits(p, "patchwork")) "patchwork" else "ggplot", title = title %||% plots[[length(plots)]]$title, plots = plots, layers = layers),
    marks = marks, sources = sources)
}

# Drawings ---------------------------------------------------------------------------------------
# Leaves of a forced page, in drawing order, each replaced by what f returns for it.
each_leaf <- function(x, f) {
  if (inherits(x, "gTree") && length(x$children)) {
    order <- match(x$childrenOrder, names(x$children))
    if (anyNA(order)) stop("A drawn part's children cannot be put in their drawing order.")
    x$children <- do.call(grid::gList, lapply(x$children[order], each_leaf, f))
    x$childrenOrder <- names(x$children)
    return(x)
  }
  f(x)
}
# The same drawn part with only the elements in `keep` (a point whose position is missing is not
# drawn, so it is left out rather than counted).
keep_elements <- function(g, keep) {
  n <- length(keep)
  for (field in c("x", "y", "x0", "y0", "x1", "y1", "width", "height", "label", "pch", "size", "r", "rot", "hjust", "vjust"))
    if (!is.null(g[[field]]) && length(g[[field]]) == n) g[[field]] <- g[[field]][keep]
  for (field in names(g$gp)) if (length(g$gp[[field]]) == n) g$gp[[field]] <- g$gp[[field]][keep]
  g
}
native <- function(u, log = FALSE) {
  if (is.null(u) || !length(u) || !all(grid::unitType(u) == "native")) return(NULL)
  v <- as.numeric(u)
  if (log) 10^v else v
}
justification <- function(g) {
  j <- g$just %||% "centre"
  side <- function(value, given, low, high) if (!is.null(given)) given else if (is.numeric(j)) j[value] else switch(j[value], left = , bottom = 0, right = , top = 1, 0.5)
  list(h = side(1L, g$hjust), v = side(length(j), g$vjust))
}

# Base graphics: gridGraphics makes the recorded page into grobs named after what drew them
# (graphics-plot-2-points-1 is the first points() of the second plot). Each kind below is one
# layer, and each element it drew one mark; axes, boxes and titles are drawn and not bound.
graphics_kinds <- c(points = "points", text = "text", rect = "rect", "image-rect" = "image", segments = "segments", arrows = "arrows",
  "abline-h" = "abline", "abline-v" = "abline", abline = "abline", lines = "lines", polygon = "polygon", path = "path", "symbols-circle" = "circles")
grouped_kinds <- c("lines", "polygon", "path")
# What each plot's window was: its limits, which axes are on a log scale, and its titles, read
# from the page's display list in the order the plots were started.
graphics_plots <- function(recorded) {
  plots <- list(); k <- 0L
  for (e in recorded[[1]]) {
    name <- tryCatch(e[[2]][[1]]$name, error = function(err) "")
    if (!is.character(name) || length(name) != 1L) next
    args <- as.list(e[[2]])[-1]
    if (name == "C_plot_new") { k <- k + 1L; plots[[k]] <- list(xlim = NULL, ylim = NULL, log = "", labels = list()) }
    else if (k > 0L && name == "C_plot_window" && length(args) >= 3L) {
      plots[[k]]$xlim <- args[[1]]; plots[[k]]$ylim <- args[[2]]
      plots[[k]]$log <- if (is.character(args[[3]]) && length(args[[3]]) == 1L) args[[3]] else ""
    } else if (k > 0L && name == "C_title" && length(args) >= 4L) {
      for (j in 1:4) { t <- label_text(args[[j]]); if (!is.null(t) && nzchar(t)) plots[[k]]$labels[[c("title", "subtitle", "x", "y")[j]]] <- t }
    }
  }
  plots
}
is_graphics_page <- function(x) inherits(x, "recordedplot") && any(vapply(x[[1]], function(e) identical(tryCatch(e[[2]][[1]]$name, error = function(err) ""), "C_plot_new"), TRUE))

# The values one drawn part was drawn at, in the data's units, one per element (a vertex of a line
# or polygon). A position not drawn in the plot's own units (a line across the whole plot) is left
# out; a bar is named by the axis label drawn at its middle.
graphics_columns <- function(g, kind, logx, logy, ticks) {
  X <- function(u) native(u, logx); Y <- function(u) native(u, logy)
  cols <- switch(kind,
    points = , "symbols-circle" = list(x = X(g$x), y = Y(g$y)),
    text = list(x = X(g$x), y = Y(g$y), label = as.character(g$label)),
    rect = , "image-rect" = {
      x <- native(g$x); y <- native(g$y); w <- native(g$width); h <- native(g$height); j <- justification(g)
      if (is.null(x) || is.null(y) || is.null(w) || is.null(h)) list() else {
        left <- x - j$h * w; bottom <- y - j$v * h
        out <- list(xmin = if (logx) 10^left else left, xmax = if (logx) 10^(left + w) else left + w,
          ymin = if (logy) 10^bottom else bottom, ymax = if (logy) 10^(bottom + h) else bottom + h)
        for (side in names(ticks)) {
          at <- ticks[[side]]$at; middle <- if (side == "bottom") left + w / 2 else bottom + h / 2
          hit <- vapply(middle, function(m) { k <- which(abs(at - m) <= 1e-9 * pmax(1, abs(m))); if (length(k) == 1L) k else NA_integer_ }, 0L)
          if (any(!is.na(hit))) { out$label <- ticks[[side]]$labels[hit]; break }
        }
        out
      }
    },
    segments = , arrows = list(x = X(g$x0), y = Y(g$y0), xend = X(g$x1), yend = Y(g$y1)),
    "abline-h" = list(yintercept = Y(g$y0)),
    "abline-v" = list(xintercept = X(g$x0)),
    lines = , polygon = , path = list(x = X(g$x), y = Y(g$y)),
    list())
  cols <- Filter(Negate(is.null), cols)
  n <- if (length(cols)) max(lengths(cols)) else 0L
  style <- Filter(function(v) !is.null(v) && length(v), list(colour = g$gp$col, fill = g$gp$fill, shape = if (kind == "points") g$pch,
    size = if (kind == "points" && !is.null(g$size)) as.numeric(g$size), radius = if (kind == "symbols-circle") native(g$r)))
  c(lapply(cols, rep_len, n), lapply(style, function(v) rep_len(if (is.factor(v)) as.character(v) else v, n)))
}
axis_ticks <- function(forced) {
  ticks <- list()
  each_leaf(forced, function(g) {
    m <- regmatches(g$name, regexec("graphics-plot-(\\d+)-(bottom|left)-axis-labels-\\d+$", g$name))[[1]]
    if (length(m) && inherits(g, "text")) {
      at <- native(if (m[3] == "bottom") g$x else g$y)
      if (!is.null(at) && length(at) == length(g$label)) ticks[[m[2]]][[m[3]]] <<- list(at = at, labels = as.character(g$label))
    }
    g
  })
  ticks
}

# A drawn part is bound to a table of the session (a data frame, a Bioconductor DataFrame, a
# numeric matrix or a named vector) when its x and y are two of the table's columns, value for
# value, over the table's rows in order; rows that were not drawn (missing values, rows filtered
# out first) are skipped. A part drawn from computed values matches no table and keeps only the
# values it was drawn at. The protected resource is the session's time: at most maxTables tables
# of at most maxTableCells cells each are compared.
near <- function(a, b) !is.na(a) & !is.na(b) & abs(a - b) <= 1e-9 * pmax(abs(a), abs(b))
rows_of <- function(drawn, column, sorted) {
  j <- findInterval(column, sorted)
  member <- near(column, sorted[pmax(j, 1L)]) | near(column, sorted[pmin(j + 1L, length(sorted))])
  member[is.na(member)] <- FALSE
  kept <- which(member)
  if (length(kept) < length(drawn)) return(NULL)
  if (length(kept) == length(drawn)) return(if (all(near(column[kept], drawn))) kept else NULL)
  out <- integer(length(drawn)); k <- 1L
  for (r in kept) { if (near(column[r], drawn[k])) { out[k] <- r; k <- k + 1L; if (k > length(drawn)) break } }
  if (k <= length(drawn)) NULL else out
}
session_tables <- function() {
  out <- list()
  for (name in ls(globalenv())) {
    if (length(out) >= limits$maxTables) break
    x <- get(name, envir = globalenv())
    size <- if (is.null(dim(x))) length(x) else prod(dim(x))
    if (!is.numeric(size) || size > limits$maxTableCells) next
    d <- tryCatch(if (is.data.frame(x)) x
      else if (isS4(x) && methods::is(x, "DataFrame")) as.data.frame(x)
      else if (is.matrix(x) && is.numeric(x)) as.data.frame(x)
      else if (is.numeric(x) && is.null(dim(x)) && !is.null(names(x)) && !anyDuplicated(names(x))) data.frame(value = unname(x), row.names = names(x))
      else NULL, error = function(e) NULL)
    if (is.data.frame(d) && nrow(d) > 0L && prod(dim(d)) <= limits$maxTableCells) out[[name]] <- d
  }
  out
}
match_table <- function(cols, tables) {
  if (!is.numeric(cols$x) || !is.numeric(cols$y)) return(NULL)
  n <- length(cols$x); best <- NULL
  sorted <- lapply(cols[c("x", "y")], function(v) sort(unique(v)))
  for (name in names(tables)) {
    d <- tables[[name]]; numeric_ <- names(d)[vapply(d, is.numeric, TRUE)]
    for (a in c("x", "y")) for (cn in numeric_) {
      rows <- rows_of(cols[[a]], d[[cn]], sorted[[a]]); if (is.null(rows)) next
      b <- setdiff(c("x", "y"), a)
      fit <- vapply(numeric_, function(c2) sum(near(d[[c2]][rows], cols[[b]])), 0)
      if (!length(fit) || max(fit) < 0.99 * n) next
      found <- list(table = name, rows = rows, mapping = stats::setNames(list(cn, names(fit)[which.max(fit)]), c(a, b)), other = b, differ = n - max(fit))
      found$mapping <- found$mapping[c("x", "y")]
      if (is.null(best) || found$differ < best$differ || (found$differ == best$differ && is.null(key_column(tables[[best$table]])) && !is.null(key_column(d)))) best <- found
      if (best$differ == 0L) break
    }
  }
  best
}

describe_graphics <- function(p, width, height, ...) {
  plots <- graphics_plots(p)
  page <- gridGraphics::echoGrob(p, name = "rho")
  layers <- list(); columns <- list(); total <- 0L
  tag <- function(forced) {
    ticks <- axis_ticks(forced)
    each_leaf(forced, function(g) {
      m <- regmatches(g$name, regexec("graphics-plot-(\\d+)-(.+)-\\d+$", g$name))[[1]]
      if (!length(m) || !m[3] %in% names(graphics_kinds)) return(g)
      k <- as.integer(m[2]); kind <- m[3]; info <- if (k <= length(plots)) plots[[k]] else list(log = "")
      cols <- graphics_columns(g, kind, grepl("x", info$log), grepl("y", info$log), ticks[[as.character(k)]] %||% list())
      positions <- intersect(names(cols), c("x", "y", "xmin", "xmax", "ymin", "ymax", "xend", "yend", "xintercept", "yintercept"))
      if (!length(positions)) return(g)
      n <- length(cols[[1]])
      if (!kind %in% grouped_kinds) {
        keep <- Reduce(`&`, lapply(cols[positions], is.finite))
        if (!all(keep)) { g <- keep_elements(g, keep); cols <- lapply(cols, `[`, keep); n <- sum(keep) }
      }
      if (!n) return(g)
      total <<- total + n
      if (total > limits$maxMarks) stop(sprintf("The plot draws more than the %d marks a figure binds.", limits$maxMarks))
      L <- length(layers) + 1L
      layers[[L]] <<- list(plot = k, kind = kind, n = n)
      columns[[L]] <<- cols
      g$rho_tag <- list(plot = k, layer = L, panel = 1L, mark = seq_len(n), group = if (kind %in% grouped_kinds) as.integer(g$id %||% rep(1L, n)) else rep(-1L, n),
        label = if (kind == "text") as.character(g$label) else NULL)
      g
    })
  }
  r <- render(page, width, height, tag)
  s <- bind(r$svg, r$units)
  units <- r$units[s$kept]
  tables <- NULL; used <- list(); sources <- list()
  out_layers <- list(); out_marks <- list()
  for (L in seq_along(layers)) {
    l <- layers[[L]]; n <- l$n
    cols <- Filter(function(v) !all(is.na(v)), columns[[L]])
    source <- NULL; mapping <- list(); notes <- NULL; rows <- NULL
    if (l$kind %in% c("points", "text", "symbols-circle", "lines")) {
      if (is.null(tables)) tables <- session_tables()
      found <- match_table(cols, tables)
      if (!is.null(found)) {
        source <- found$table; rows <- found$rows; mapping <- found$mapping
        used[[source]] <- sort(unique(c(used[[source]], rows)))
        if (found$differ > 0L) notes <- sprintf("%d of %d marks are drawn at a %s other than their %s.", found$differ, n, found$other, mapping[[found$other]])
      }
    }
    constant <- names(cols)[grepl(style_columns, names(cols)) & vapply(cols, function(v) n > 1L && length(unique(v)) == 1L, TRUE)]
    varying <- setdiff(names(cols), constant)
    mine <- vapply(units, function(u) u$layer == L, TRUE)
    lost <- Filter(function(u) u$layer == L, r$unbound)
    out_marks[[L]] <- list(panel = I(rep(1L, n)), group = I(rep(if (l$kind %in% grouped_kinds) 1L else -1L, n)), row = if (!is.null(rows)) I(as.integer(rows) - 1L) else NULL,
      columns = lapply(varying, function(v) c(list(name = v), column(cols[[v]], seq_len(n)))))
    out_layers[[L]] <- list(plot = l$plot, layer = L, geom = graphics_kinds[[l$kind]], stat = "identity", position = "identity", mapping = mapping,
      constants = lapply(cols[constant], function(v) if (is.numeric(v)) signif(v[1], 7) else as.character(v[1])),
      source = source, marks = n, units = sum(mine),
      bound = if (!any(mine)) "none" else if (all(vapply(units[mine], function(u) all(lengths(u$marks) == 1L), TRUE))) "mark" else "group",
      unbound = if (length(lost)) I(unique(vapply(lost, `[[`, "", "reason"))) else NULL, notes = if (length(notes)) I(notes) else NULL)
  }
  for (name in names(used)) sources[[length(sources) + 1L]] <- c(list(id = name), table_of(tables[[name]], used[[name]]))
  out_plots <- lapply(seq_along(plots), function(k) {
    p <- plots[[k]]
    axis <- function(lim, log) if (is.numeric(lim) && length(lim) == 2L) c(list(discrete = FALSE, range = I(signif(lim, 7))), if (log) list(transform = "log-10"))
    list(plot = k, title = p$labels$title, subtitle = p$labels$subtitle, caption = NULL, labels = p$labels[intersect(names(p$labels), c("x", "y"))],
      panels = list(list(panel = 1L, facets = structure(list(), names = character()))), facet = "Null", coord = "cartesian", scales = list(),
      positions = Filter(Negate(is.null), list(x = axis(p$xlim, grepl("x", p$log)), y = axis(p$ylim, grepl("y", p$log)))))
  })
  list(svg = s$svg, problems = I(s$problems),
    units = lapply(units, function(u) list(layer = u$layer - 1L, panel = u$panel, marks = lapply(u$marks, function(m) I(as.integer(m) - 1L)))),
    figure = list(kind = "graphics", title = if (length(out_plots)) out_plots[[1]]$title else NULL, plots = out_plots, layers = out_layers),
    marks = out_marks, sources = sources)
}

# ComplexHeatmap -----------------------------------------------------------------------------------
# draw() starts the page before it lays the heatmaps out, in the frame of its own method, so that
# frame is kept when the page starts and its laid-out heatmap list is read when the page is
# described: the rows and columns in the order and slices drawn, and the matrix. The page is drawn
# again from its recording, and each cell rectangle of a heatmap body is one mark. Annotations,
# dendrograms and names are drawn and not bound.
heatmap_frame <- function() {
  if (!isNamespaceLoaded("ComplexHeatmap")) return(NULL)
  for (i in rev(seq_len(sys.nframe()))) {
    env <- sys.frame(i)
    if (inherits(get0("object", envir = env, inherits = FALSE), "HeatmapList")) return(structure(list(frame = env), class = "rho_heatmap"))
  }
  NULL
}
# A grabbed page names each part's viewport by its path, and grid matches a path as a regular
# expression: a heatmap named "z-score (VST)" would not find its own viewports. Paths are made
# literal before the page is drawn again.
literal <- function(s) gsub("([][{}()+*^$|\\\\?.])", "\\\\\\1", s)
literal_paths <- function(x) {
  if (inherits(x$vp, "vpPath")) x$vp$path <- literal(x$vp$path)
  if (inherits(x, "gTree") && length(x$children)) for (n in names(x$children)) x$children[[n]] <- literal_paths(x$children[[n]])
  x
}
viewport_name <- function(vp) if (inherits(vp, "viewport") || inherits(vp, "vpPath")) vp$name else if (inherits(vp, "vpStack") && length(vp)) viewport_name(vp[[length(vp)]]) else NULL
describe_heatmap <- function(h, width, height, recorded = NULL, ...) {
  o <- get0("object", envir = h$frame, inherits = FALSE)
  if (!inherits(o, "HeatmapList") || !isTRUE(o@layout$initialized)) stop("The heatmap was not laid out when its page was drawn; it stays a picture.")
  if (is.null(recorded)) stop("The heatmap's page was not recorded; it stays a picture.")
  maps <- Filter(function(x) inherits(x, "Heatmap"), o@ht_list)
  shape <- lapply(maps, function(m) list(rows = m@row_order_list, cols = m@column_order_list))
  total <- sum(vapply(shape, function(s) length(unlist(s$rows)) * length(unlist(s$cols)), 0))
  if (total > limits$maxMarks) stop(sprintf("The heatmap draws %d cells, more than the %d a figure binds.", total, limits$maxMarks))
  bodies <- paste0("^(", paste(vapply(maps, function(m) literal(m@name), ""), collapse = "|"), ")_heatmap_body_(\\d+)_(\\d+)$")
  reasons <- list()
  tag <- function(forced) each_leaf(forced, function(g) {
    m <- regmatches(viewport_name(g$vp) %||% "", regexec(bodies, viewport_name(g$vp) %||% ""))[[1]]
    if (!length(m)) return(g)
    k <- match(m[2], vapply(maps, function(x) x@name, "")); i <- as.integer(m[3]); j <- as.integer(m[4])
    s <- shape[[k]]; rows <- s$rows[[i]]; cols <- s$cols[[j]]
    if (inherits(g, "rastergrob")) { reasons[[length(reasons) + 1L]] <<- list(layer = k, reason = "draws its cells as one image (use_raster)"); return(g) }
    if (!inherits(g, "rect") || max(length(g$x), length(g$y)) != length(rows) * length(cols)) return(g)
    x <- as.numeric(g$x); y <- as.numeric(g$y)
    column <- match(x, sort(unique(x))); row <- match(y, sort(unique(y), decreasing = TRUE))
    if (max(column) != length(cols) || max(row) != length(rows) || anyDuplicated(paste(row, column))) { reasons[[length(reasons) + 1L]] <<- list(layer = k, reason = "draws cells that are not in a grid of its rows and columns"); return(g) }
    before_rows <- sum(lengths(s$rows[seq_len(i - 1L)])); before_cols <- sum(lengths(s$cols[seq_len(j - 1L)]))
    g$rho_tag <- list(plot = k, layer = k, panel = (i - 1L) * length(s$cols) + j, mark = (before_rows + row - 1L) * length(unlist(s$cols)) + before_cols + column, group = rep(-1L, length(x)))
    g
  })
  r <- render(function() { grDevices::replayPlot(recorded); literal_paths(grid::grid.grab()) }, width, height, tag)
  s <- bind(r$svg, r$units)
  units <- r$units[s$kept]
  layers <- list(); marks <- list(); plots <- list(); sources <- list()
  for (k in seq_along(maps)) {
    hm <- maps[[k]]; rows <- shape[[k]]$rows; cols <- shape[[k]]$cols; m <- hm@matrix
    r_all <- unlist(rows, use.names = FALSE); c_all <- unlist(cols, use.names = FALSE)
    a <- rep(seq_along(r_all), each = length(c_all)); b <- rep(seq_along(c_all), times = length(r_all))
    ri <- r_all[a]; ci <- c_all[b]
    name_of <- function(names_, i) if (is.null(names_)) i else names_[i]
    slice <- function(parts, at) rep(seq_along(parts), lengths(parts))[at]
    built <- list(row = name_of(rownames(m), ri), column = name_of(colnames(m), ci), value = m[cbind(ri, ci)])
    if (length(rows) > 1L) built[["row slice"]] <- (names(rows) %||% as.character(seq_along(rows)))[slice(rows, a)]
    if (length(cols) > 1L) built[["column slice"]] <- (names(cols) %||% as.character(seq_along(cols)))[slice(cols, b)]
    panel <- (slice(rows, a) - 1L) * length(cols) + slice(cols, b)
    source <- NULL
    for (n in ls(globalenv())) { x <- get(n, envir = globalenv()); if (is.matrix(x) && identical(dim(x), dim(m)) && identical(unname(x), unname(m)) && identical(dimnames(x), dimnames(m))) { source <- n; break } }
    source <- source %||% hm@name
    sources[[length(sources) + 1L]] <- c(list(id = source), table_of(as.data.frame(m), sort(unique(r_all))))
    marks[[k]] <- list(panel = I(as.integer(panel)), group = I(rep(-1L, length(a))), row = I(as.integer(ri) - 1L),
      columns = lapply(names(built), function(v) c(list(name = v), column(built[[v]], seq_along(a)))))
    mine <- vapply(units, function(u) u$layer == k, TRUE)
    lost <- c(Filter(function(u) u$layer == k, r$unbound), Filter(function(u) u$layer == k, reasons))
    layers[[k]] <- list(plot = k, layer = k, geom = "heatmap", stat = "identity", position = "identity", mapping = list(x = "column", y = "row", fill = "value"),
      constants = structure(list(), names = character()), source = source, marks = length(a), units = sum(mine), bound = if (any(mine)) "mark" else "none",
      unbound = if (length(lost)) I(unique(vapply(lost, `[[`, "", "reason"))) else if (!any(mine)) I("draws its cells with functions of its own") else NULL)
    cm <- hm@matrix_color_mapping
    scale <- tryCatch(list(list(aesthetic = "fill", title = cm@name, breaks = I(as.character(signif(as.numeric(cm@levels), 4))), values = I(as.character(cm@colors)))), error = function(e) list())
    title <- tryCatch(paste(hm@column_title, collapse = " "), error = function(e) "")
    panels <- list()
    for (i in seq_along(rows)) for (j in seq_along(cols)) panels[[length(panels) + 1L]] <- list(panel = (i - 1L) * length(cols) + j,
      facets = c(if (length(rows) > 1L) list(`row slice` = (names(rows) %||% as.character(seq_along(rows)))[i]), if (length(cols) > 1L) list(`column slice` = (names(cols) %||% as.character(seq_along(cols)))[j])) %||% structure(list(), names = character()))
    plots[[k]] <- list(plot = k, title = if (nzchar(title)) title else NULL, subtitle = NULL, caption = NULL, labels = list(fill = cm@name),
      panels = panels, facet = if (length(panels) > 1L) "slices" else "Null", coord = "heatmap", scales = scale,
      positions = list(x = list(discrete = TRUE, levels = I(as.character(name_of(colnames(m), c_all)))), y = list(discrete = TRUE, levels = I(as.character(name_of(rownames(m), r_all))))))
  }
  list(svg = s$svg, problems = I(s$problems),
    units = lapply(units, function(u) list(layer = u$layer - 1L, panel = u$panel, marks = lapply(u$marks, function(m) I(as.integer(m) - 1L)))),
    figure = list(kind = "ComplexHeatmap", title = plots[[1]]$title, plots = plots, layers = layers), marks = marks, sources = sources)
}

# The page's describer. Other plot systems join with a recognizer and a describe function of their
# own.
describers <- list(
  ggplot = list(accepts = function(x) inherits(x, "ggplot"), describe = describe_ggplot, packages = c("ggplot2", "svglite", "xml2", "jsonlite")),
  ComplexHeatmap = list(accepts = function(x) inherits(x, "rho_heatmap"), describe = describe_heatmap, packages = c("ComplexHeatmap", "svglite", "xml2", "jsonlite")),
  graphics = list(accepts = is_graphics_page, describe = describe_graphics, packages = c("gridGraphics", "svglite", "xml2", "jsonlite")))

describe_page <- function(object, file, width, height, into = sub("\\.png$", ".figure.json", file), recorded = NULL) {
  name <- names(Filter(function(d) d$accepts(object), describers))[1]
  if (is.na(name)) return(NULL)
  d <- describers[[name]]
  missing <- d$packages[!vapply(d$packages, requireNamespace, TRUE, quietly = TRUE)]
  if (length(missing)) return(list(problem = paste0("Install ", paste(missing, collapse = ", "), " in this session's library to make plots like this one selectable.")))
  had <- exists(".Random.seed", envir = globalenv(), inherits = FALSE)
  if (had) seed <- get(".Random.seed", envir = globalenv())
  on.exit({
    if (had) assign(".Random.seed", seed, envir = globalenv())
    else if (exists(".Random.seed", envir = globalenv(), inherits = FALSE)) rm(".Random.seed", envir = globalenv())
  }, add = TRUE)
  started <- Sys.time()
  result <- NULL; problem <- NULL
  utils::capture.output(withCallingHandlers(
    tryCatch({
      setTimeLimit(elapsed = limits$maxSeconds, transient = TRUE)
      on.exit(setTimeLimit(elapsed = Inf), add = TRUE)
      result <- d$describe(object, width, height, recorded = recorded)
    }, error = function(e) problem <<- conditionMessage(e)),
    warning = function(w) invokeRestart("muffleWarning"), message = function(m) invokeRestart("muffleMessage")))
  setTimeLimit(elapsed = Inf)
  if (!is.null(problem)) return(list(problem = if (grepl("time limit", problem)) sprintf("Describing the plot took longer than %d s; it stays a picture.", limits$maxSeconds) else problem))
  versions <- vapply(setdiff(d$packages, c("xml2", "jsonlite")), function(p) as.character(utils::packageVersion(p)), "")
  record <- c(list(schema = schema, describer = name, size = list(width = width, height = height, units = "in"),
    versions = as.list(c(R = as.character(getRversion()), versions)), seconds = round(as.numeric(Sys.time() - started, units = "secs"), 2)), result)
  json <- jsonlite::toJSON(record, auto_unbox = TRUE, null = "null", na = "null", digits = NA)
  if (nchar(json, type = "bytes") > limits$maxBytes) return(list(problem = sprintf("The figure record would take %.1f MB, more than %d MB.", nchar(json, type = "bytes") / 1048576, limits$maxBytes / 1048576)))
  out <- into
  tmp <- paste0(out, ".tmp")
  writeLines(json, tmp, useBytes = TRUE)
  file.rename(tmp, out)
  f <- result$figure
  Filter(Negate(is.null), list(describer = name, kind = f$kind, title = f$title, layers = length(f$layers),
    marks = sum(vapply(f$layers, `[[`, 0L, "marks")),
    bound = length(unique(unlist(lapply(result$units, function(u) paste(u$layer, unlist(u$marks)))))),
    geoms = I(vapply(f$layers, `[[`, "", "geom")), file = basename(out)))
}
