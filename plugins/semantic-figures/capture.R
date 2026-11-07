# Native rendering and point bindings shared by the two observed adapters.
# Other geometry is kept as drawn; no role is inferred from screen position.
rho_points <- function(p, layer_index, keys, layer_data = NULL) {
  layer <- p$layers[[layer_index]]
  if (!inherits(layer$geom, "GeomPoint")) stop("The selected native layer is not a point layer.")
  if (is.null(layer_data)) layer_data <- if (is.function(layer$data)) layer$data(p$data) else if (is.data.frame(layer$data)) layer$data else p$data
  if (length(keys) != nrow(layer_data) || anyNA(keys)) stop("Point keys do not match the native layer data.")
  layer_data$.rho_group <- seq_along(keys)
  layer$data <- layer_data
  layer$mapping$group <- ggplot2::aes(group = .rho_group)$group
  original <- layer$geom
  layer$geom <- ggplot2::ggproto(NULL, original,
    draw_panel = function(data, panel_params, coord, na.rm = FALSE) {
      grob <- original$draw_panel(data, panel_params, coord, na.rm = na.rm)
      if (!inherits(grob, "points")) stop("Unsupported native point geometry; no binding was guessed.")
      selected <- keys[data$group]
      if (length(selected) != length(grob$x) || anyNA(selected)) stop("Native point count changed; no binding was guessed.")
      grob$rho_keys <- selected
      grob
    })
  p$layers[[layer_index]] <- layer
  p
}

rho_svg <- function(p, width, height) {
  capture <- svglite::svgstring(width, height)
  on.exit(grDevices::dev.off(), add = TRUE)
  grob <- grid::grid.force(ggplot2::ggplotGrob(p))
  records <- list()
  wrap <- function(x) {
    if (inherits(x, "gTree")) {
      order <- match(x$childrenOrder, names(x$children))
      if (anyNA(order)) stop("Native child draw order cannot be resolved.")
      x$children <- do.call(grid::gList, lapply(x$children[order], wrap))
      x$childrenOrder <- names(x$children)
    }
    if (!is.null(x$rho_keys)) {
      records[[length(records) + 1L]] <<- x$rho_keys
      vp <- x$vp; x$vp <- NULL
      return(grid::groupGrob(x, vp = vp, name = x$name))
    }
    x
  }
  grid::grid.newpage(); grid::grid.draw(wrap(grob))
  grDevices::dev.off(); on.exit(NULL)
  doc <- xml2::read_xml(as.character(tail(capture(), 1L))); xml2::xml_ns_strip(doc)
  groups <- xml2::xml_find_all(doc, ".//defs/g[starts-with(@id, 'group-')]")
  if (length(groups) != length(records)) stop("SVG group count does not match the tagged point layers.")
  for (i in seq_along(records)) {
    marks <- xml2::xml_find_all(groups[[i]], "./circle")
    if (length(marks) != length(records[[i]])) stop("SVG mark count does not match the native data; no partial binding was published.")
    xml2::xml_set_attr(marks, "data-rho-key", records[[i]])
    xml2::xml_set_attr(marks, "tabindex", "0")
    xml2::xml_set_attr(marks, "role", "button")
    xml2::xml_set_attr(marks, "aria-label", records[[i]])
  }
  # Inline only our recorded groups, retaining the device's transform and clip.
  for (use in xml2::xml_find_all(doc, ".//use")) {
    ref <- sub("^#", "", xml2::xml_attr(use, "href"))
    idx <- which(xml2::xml_attr(groups, "id") == ref)
    if (length(idx) != 1L) stop("Unexpected SVG group reference.")
    node <- xml2::xml_add_sibling(use, groups[[idx]], .copy = TRUE)
    xml2::xml_set_attr(node, "id", NA_character_)
    for (key in names(xml2::xml_attrs(use))) if (key != "href") xml2::xml_set_attr(node, key, xml2::xml_attr(use, key))
    xml2::xml_remove(use)
  }
  xml2::xml_remove(groups)
  xml2::xml_set_attr(xml2::xml_root(doc), "xmlns", "http://www.w3.org/2000/svg")
  list(svg = as.character(doc), boundMarks = sum(lengths(records)))
}

rho_capture <- function(adapter, source, output, title, source_path, source_sha, show_category = 5L, adapter_directory) {
  had_seed <- exists(".Random.seed", envir = .GlobalEnv, inherits = FALSE)
  if (had_seed) original_seed <- get(".Random.seed", envir = .GlobalEnv)
  on.exit({
    if (had_seed) assign(".Random.seed", original_seed, envir = .GlobalEnv)
    else if (exists(".Random.seed", envir = .GlobalEnv, inherits = FALSE)) rm(".Random.seed", envir = .GlobalEnv)
  }, add = TRUE)
  needed <- c("ggplot2", "svglite", "xml2", "jsonlite", "digest", if (adapter == "ggtree") c("ggtree", "ape") else "enrichplot")
  missing <- needed[!vapply(needed, requireNamespace, TRUE, quietly = TRUE)]
  if (length(missing)) stop("Missing R packages: ", paste(missing, collapse = ", "), ". Install them in this session's library, then capture again.")
  object <- readRDS(source)
  sys.source(file.path(adapter_directory, paste0(adapter, ".R")), envir = environment())
  result <- rho_adapter(object, show_category)
  result$schema <- "rho.semantic-figure/1"; result$adapter <- adapter; result$title <- title
  result$source <- list(path = source_path, sha256 = source_sha, class = class(object))
  result$createdAt <- format(Sys.time(), "%Y-%m-%dT%H:%M:%OSZ", tz = "UTC")
  result$versions <- as.list(setNames(vapply(needed, function(p) as.character(utils::packageVersion(p)), ""), needed))
  result$versions$R <- as.character(getRversion())
  json <- jsonlite::toJSON(result, auto_unbox = TRUE, null = "null", digits = 12, dataframe = "rows", pretty = TRUE)
  if (nchar(json, type = "bytes") > 786432L) stop("Figure exceeds 768 KiB. Use a smaller tree or fewer categories; earlier figures are retained.")
  tmp <- file.path(output, "figure.tmp"); writeLines(json, tmp, useBytes = TRUE)
  if (!file.rename(tmp, file.path(output, "figure.json"))) stop("Could not commit figure output.")
  cat("Captured ", adapter, ": ", length(result$entities), " selectable entities; native plots and bindings saved.\n", sep = "")
}
