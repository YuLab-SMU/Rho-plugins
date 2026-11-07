# Semantic figures for a live R session. The Notebook's runner sources this file into an
# environment of its own and calls two functions:
#
#   page_object()   when a page starts on the session's recording device: the plot object being
#                   drawn there, if a describer knows how to find it (NULL otherwise);
#   describe_page(object, file, width, height)
#                   after that page's picture is written to `file`: writes the figure record
#                   beside it (<file without .png>.figure.json) and returns a short summary.
#
# A describer recognizes one kind of plot object and binds what it draws to the data behind it.
# The first is ggplot2's: any plot built on ggplot2 layers (ggtree, enrichplot, Seurat, ggpubr,
# survminer and the rest) is described from its own layers and data, with no package-specific
# code. Domain packages can add meaning on top later; nothing here guesses a role from pixels.
#
# A describer never changes the session: printed output, warnings and messages are discarded,
# the random number stream is restored, and a failure leaves the page as a picture with the
# reason. The protected resources are the session's time and the state folder: a description
# stops after maxSeconds, refuses more than maxMarks drawn marks and writes at most maxBytes.
limits <- list(maxMarks = 20000L, maxColumns = 40L, maxCellChars = 160L, maxSeconds = 20, maxBytes = 8L * 1024L * 1024L)
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
page_object <- function() {
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
  if (inherits(grob, c("polyline", "polygon", "pathgrob"))) {
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

render <- function(gt, width, height) {
  capture <- svglite::svgstring(width, height, standalone = TRUE, web_fonts = list())
  open <- TRUE
  on.exit(if (open) grDevices::dev.off(), add = TRUE)
  grob <- grid::grid.force(gt)
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

describe_ggplot <- function(p, width, height) {
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

# The page's describer: ggplot2 for now. Other plot systems join with a recognizer and a
# describe function of their own.
describers <- list(ggplot = list(accepts = function(x) inherits(x, "ggplot"), describe = describe_ggplot,
  packages = c("ggplot2", "svglite", "xml2", "jsonlite")))

describe_page <- function(object, file, width, height) {
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
      result <- d$describe(object, width, height)
    }, error = function(e) problem <<- conditionMessage(e)),
    warning = function(w) invokeRestart("muffleWarning"), message = function(m) invokeRestart("muffleMessage")))
  setTimeLimit(elapsed = Inf)
  if (!is.null(problem)) return(list(problem = if (grepl("time limit", problem)) sprintf("Describing the plot took longer than %d s; it stays a picture.", limits$maxSeconds) else problem))
  versions <- vapply(c("ggplot2", "svglite"), function(p) as.character(utils::packageVersion(p)), "")
  record <- c(list(schema = schema, describer = name, size = list(width = width, height = height, units = "in"),
    versions = as.list(c(R = as.character(getRversion()), versions)), seconds = round(as.numeric(Sys.time() - started, units = "secs"), 2)), result)
  json <- jsonlite::toJSON(record, auto_unbox = TRUE, null = "null", na = "null", digits = NA)
  if (nchar(json, type = "bytes") > limits$maxBytes) return(list(problem = sprintf("The figure record would take %.1f MB, more than %d MB.", nchar(json, type = "bytes") / 1048576, limits$maxBytes / 1048576)))
  out <- sub("\\.png$", ".figure.json", file)
  tmp <- paste0(out, ".tmp")
  writeLines(json, tmp, useBytes = TRUE)
  file.rename(tmp, out)
  f <- result$figure
  Filter(Negate(is.null), list(describer = name, kind = f$kind, title = f$title, layers = length(f$layers),
    marks = sum(vapply(f$layers, `[[`, 0L, "marks")),
    bound = length(unique(unlist(lapply(result$units, function(u) paste(u$layer, unlist(u$marks)))))),
    geoms = I(vapply(f$layers, `[[`, "", "geom")), file = basename(out)))
}
