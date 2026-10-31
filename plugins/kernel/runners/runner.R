# A live R session for Rho. It reads one JSON request per line on stdin. What the code prints
# goes to standard output as it is printed, as in the R console; messages, warnings, errors,
# plots and the end of a cell are answered on file descriptor 3. Each answer about a cell is
# preceded on standard output by a numbered mark, so the reader can put it in its place among
# the printed lines. Code runs in the global environment of this one process, top-level
# expression by top-level expression, and the first error stops the rest of the cell. An
# interrupt (SIGINT) stops the cell that is running and leaves the session and its variables.
# The runner's own names live in a local environment, so the global one holds only what the
# code defines.
local({
if (!requireNamespace("jsonlite", quietly = TRUE)) {
  cat("The live R session needs the R package jsonlite. Install it with install.packages(\"jsonlite\").\n", file = stderr())
  quit(save = "no", status = 2)
}
setwd(commandArgs(trailingOnly = TRUE)[[1]])
answers <- file("/dev/fd/3", open = "w")
emit <- function(x) { writeLines(jsonlite::toJSON(x, auto_unbox = TRUE, null = "null", digits = NA, force = TRUE), answers); flush(answers) }
marks <- 0L
# An answer about the running cell, after a mark that follows everything printed before it.
say <- function(x) {
  marks <<- marks + 1L
  cat("\036RHO:", marks, "\036", sep = ""); flush(stdout())
  x$seq <- marks; emit(x)
}
input <- file("stdin"); open(input, "r")

clip <- function(text, n) if (nchar(text) > n) paste0(substr(text, 1, n - 1), "…") else text
describe <- function(x) {
  if (is.function(x)) return(clip(paste(deparse(base::args(x))[1], collapse = " "), 160))
  if (inherits(x, c("lm", "glm"))) return(clip(paste(class(x)[1], paste(deparse(formula(x)), collapse = " ")), 160))
  if (is.data.frame(x)) return(clip(paste(names(x), collapse = ", "), 160))
  if (is.list(x) && !is.null(names(x))) return(clip(paste(names(x), collapse = ", "), 160))
  line <- tryCatch(utils::capture.output(utils::str(x, max.level = 0, give.attr = FALSE, vec.len = 3))[1], error = function(e) "")
  clip(trimws(gsub("\\s+", " ", if (is.na(line)) "" else line)), 160)
}
variables <- function(most) {
  names <- ls(globalenv())
  shown <- utils::head(names, most)
  list(items = lapply(shown, function(n) {
    x <- get(n, envir = globalenv())
    d <- dim(x)
    list(name = n, type = class(x)[1],
         size = if (!is.null(d)) paste(d, collapse = " × ") else if (is.function(x) || is.environment(x)) "" else as.character(length(x)),
         bytes = as.numeric(utils::object.size(x)), summary = describe(x))
  }), omitted = length(names) - length(shown))
}
same <- function(a, b) length(a) == length(b) && all(vapply(seq_along(a), function(j) identical(a[[j]], b[[j]]), logical(1)))
# What a page draws: its display list without the calls that only set graphics state, such as the
# par() a plot function calls before it starts a new page.
quiet <- c("C_par", "palette", "palette2", "C_layout")
drawn <- function(list) Filter(function(e) !(tryCatch({ f <- e[[2]][[1]]; if (is.list(f) && !is.null(f$name)) f$name else "" }, error = function(err) "") %in% quiet), list)
# A plot that only adds to the one before it (a line drawn over points) replaces it.
final_plots <- function(plots) {
  keep <- rep(TRUE, length(plots))
  for (i in seq_along(plots)[-length(plots)]) {
    a <- plots[[i]][[1]]; b <- plots[[i + 1]][[1]]
    if (length(b) >= length(a) && same(a, b[seq_along(a)])) keep[i] <- FALSE
  }
  plots[keep]
}
# The call a condition came from, as the console names it; one raised by the cell itself at top
# level names none (the runner's own eval is not the person's code).
call_text <- function(condition) {
  call <- conditionCall(condition)
  if (is.null(call) || identical(call, quote(eval(expr, globalenv())))) return("")
  paste0(" in ", paste(deparse(call, nlines = 1), collapse = " "))
}

# Plots are recorded on a device that draws nothing. It stays open for the session, as the
# console's does, so a later cell can draw over an earlier cell's plot (a line over its points).
# A page is recorded before a new page starts and after each top-level expression, so a script
# that draws several keeps each; a cell reports the pages it drew or changed, drawn to files at
# its end. A device the code opens itself is its own.
device <- NULL; seen <- NULL; plots <- list()
recording <- function() {
  if (!is.null(device) && device %in% grDevices::dev.list()) { grDevices::dev.set(device); return() }
  grDevices::pdf(NULL, width = 7, height = 5); grDevices::dev.control("enable")
  device <<- grDevices::dev.cur(); seen <<- NULL
}
snapshot <- function() {
  if (is.null(device) || !(device %in% grDevices::dev.list())) return()
  current <- grDevices::dev.cur(); if (current != device) grDevices::dev.set(device)
  p <- grDevices::recordPlot()
  if (current != device) grDevices::dev.set(current)
  if (length(drawn(p[[1]])) && !(length(seen) && same(drawn(p[[1]]), drawn(seen)))) { plots[[length(plots) + 1]] <<- p; seen <<- p[[1]] }
}
setHook("before.plot.new", function() snapshot())
setHook("before.grid.newpage", function() snapshot())

run <- function(msg) {
  id <- msg$id; plots <<- list(); ok <- TRUE; interrupted <- FALSE
  recording()
  tryCatch({
    exprs <- tryCatch(parse(text = msg$code, keep.source = FALSE), error = function(e) {
      ok <<- FALSE; say(list(id = id, kind = "error", text = paste0("Error: ", conditionMessage(e), "\n"))); NULL })
    for (expr in exprs) {
      went <- withCallingHandlers(
        tryCatch({
          shown <- withVisible(eval(expr, globalenv()))
          if (shown$visible) { if (isS4(shown$value)) methods::show(shown$value) else print(shown$value) }
          TRUE
        }, error = function(e) { ok <<- FALSE; say(list(id = id, kind = "error", text = paste0("Error", call_text(e), ": ", conditionMessage(e), "\n"))); FALSE }),
        warning = function(w) { say(list(id = id, kind = "warning", text = paste0("Warning", call_text(w), ": ", conditionMessage(w), "\n"))); invokeRestart("muffleWarning") },
        message = function(m) { say(list(id = id, kind = "stderr", text = conditionMessage(m))); invokeRestart("muffleMessage") })
      snapshot()
      if (!went) break
    }
  }, interrupt = function(e) { interrupted <<- TRUE; ok <<- FALSE; cat("\n") })
  shown <- final_plots(plots); plots <<- list()
  for (i in seq_along(shown)) {
    if (i > msg$maxPlots) break
    file <- file.path(msg$plots, paste0(id, "-", i, ".png"))
    grDevices::png(file, width = 7, height = 5, units = "in", res = 144)
    tryCatch(grDevices::replayPlot(shown[[i]]), error = function(e) NULL)
    grDevices::dev.off()
    say(list(id = id, kind = "plot", file = file, width = 1008, height = 720))
  }
  say(list(id = id, kind = "done", ok = ok, interrupted = interrupted, variables = variables(msg$maxVariables)))
}

# Looking at a value without changing it: what kind of thing it is and its facts, a page of its
# rows, elements or parts, and the code that reaches each part. Nothing is printed to standard
# output and nothing is assigned in the global environment; a value's own print method may run
# for its printed form. Every list, page and text is cut at the limits the host sends.
strings <- function(x) I(as.character(x))
sym <- function(n) if (nzchar(n) && identical(make.names(n), n)) n else paste0("`", gsub("`", "\\\\`", n), "`")
size_of <- function(x) { d <- dim(x); if (!is.null(d)) paste(d, collapse = " × ") else if (is.function(x) || is.environment(x)) "" else as.character(length(x)) }
# A page of values as R prints them in a table, each cut to a cell's width.
# A column of results (coefficients) has each value at its own precision, without padding.
cells <- function(v, width, each = FALSE) {
  out <- if (is.factor(v)) as.character(v)
    else if (is.list(v)) vapply(v, function(e) paste0("<", class(e)[1], if (length(e) != 1) paste0(" ", length(e)) else "", ">"), "")
    else if (is.double(v)) if (each) vapply(v, function(e) format(e, digits = 6), "") else format(v, digits = 6, trim = TRUE)
    else if (inherits(v, c("Date", "POSIXt"))) format(v)
    else as.character(v)
  out[is.na(v) & !is.list(v)] <- "NA"
  vapply(out, function(s) clip(s, width), "", USE.NAMES = FALSE)
}
number <- function(v) format(signif(v, 6), trim = TRUE)
column_summary <- function(v, limits) {
  n <- length(v)
  if (is.numeric(v) && !all(is.na(v))) return(paste(number(min(v, na.rm = TRUE)), "–", number(max(v, na.rm = TRUE))))
  if (is.factor(v)) return(paste(nlevels(v), "levels"))
  if (is.logical(v)) return(paste(sum(v, na.rm = TRUE), "TRUE"))
  if (inherits(v, c("Date", "POSIXt")) && !all(is.na(v))) return(paste(format(min(v, na.rm = TRUE)), "–", format(max(v, na.rm = TRUE))))
  if (is.character(v) && n <= limits$maxSortRows) return(paste(length(unique(v)), "distinct"))
  ""
}
# One page of a table's rows, in the order asked for; the row labels name the rows as they are.
table_page <- function(df, msg, labels = NULL, each = FALSE) {
  limits <- msg$limits
  n <- nrow(df); total <- ncol(df); shown <- seq_len(min(total, limits$maxColumns))
  ordering <- seq_len(n); sorted <- NULL; refused <- NULL
  if (!is.null(msg$sort) && msg$sort$column + 1 <= total) {
    if (n > limits$maxSortRows) refused <- paste("Sorting takes at most", limits$maxSortRows, "rows.")
    else { ordering <- order(df[[msg$sort$column + 1]], decreasing = isTRUE(msg$sort$descending), na.last = TRUE); sorted <- msg$sort }
  }
  offset <- min(msg$offset, max(0, n - 1)); rows <- if (n) ordering[seq(offset + 1, min(n, offset + msg$limit))] else integer(0)
  if (is.null(labels)) labels <- if (.row_names_info(df) > 0) rownames(df) else as.character(seq_len(n))
  names_ <- names(df); if (is.null(names_)) names_ <- paste0("V", seq_len(total))
  list(rows = n, columnsTotal = total, offset = offset, rowLabels = strings(labels[rows]), sort = sorted, sortRefused = refused,
       columns = lapply(shown, function(j) { v <- df[[j]]
         list(name = names_[j], type = class(v)[1], numeric = is.numeric(v), missing = sum(is.na(v)), summary = column_summary(v, limits), values = strings(cells(v[rows], limits$maxCellChars, each))) }))
}
# The parts a value is made of, and how code reaches each one.
parts <- function(x) {
  if (isS4(x)) { nm <- methods::slotNames(x); return(list(names = nm, get = function(i) methods::slot(x, nm[i]), code = function(e, i) paste0(e, "@", nm[i]))) }
  if (is.environment(x)) { nm <- sort(ls(x)); return(list(names = nm, get = function(i) get(nm[i], envir = x), code = function(e, i) paste0(e, "$", sym(nm[i])))) }
  if (is.list(x)) {
    nm <- names(x); if (is.null(nm)) nm <- rep("", length(x)); nm[is.na(nm)] <- ""
    once <- !(duplicated(nm) | duplicated(nm, fromLast = TRUE))
    return(list(names = nm, get = function(i) x[[i]], code = function(e, i) if (nzchar(nm[i]) && once[i]) paste0(e, "$", sym(nm[i])) else paste0(e, "[[", i, "]]")))
  }
  NULL
}
models <- c("lm", "glm", "nls", "aov", "coxph", "survreg", "lme", "merMod", "gam", "polr", "multinom", "negbin", "betareg", "rq", "loess", "Arima")
kind_of <- function(x) {
  if (is.data.frame(x) || (is.matrix(x) && length(dim(x)) == 2)) "table"
  else if (inherits(x, models) || inherits(x, "htest")) "model"
  else if (is.function(x)) "function"
  else if (is.atomic(x) && is.null(dim(x)) && length(x) == 1 && is.null(names(x)) && !is.factor(x)) "value"
  else if (is.atomic(x) && (is.null(dim(x)) || length(dim(x)) == 1)) "vector"
  else if (is.list(x) || is.environment(x) || isS4(x)) "list"
  else "other"
}
printed <- function(x, limits, label) {
  lines <- tryCatch(utils::capture.output(print(x)), error = function(e) paste("It could not be printed:", conditionMessage(e)))
  text <- paste(lines, collapse = "\n")
  cut <- nchar(text, type = "bytes") > limits$maxText
  if (cut) text <- substr(text, 1, limits$maxText)
  list(label = label, text = text, cut = cut)
}
describe_value <- function(x, msg, name, code, trail) {
  limits <- msg$limits; facts <- list()
  fact <- function(label, value) if (!is.null(value) && length(value) && !all(is.na(value))) facts[[length(facts) + 1]] <<- list(label = label, value = clip(paste(value, collapse = " "), 200))
  kind <- kind_of(x)
  out <- list(name = name, expression = code, trail = trail, kind = kind, type = class(x)[1], size = size_of(x), bytes = as.numeric(utils::object.size(x)))
  if (kind == "table") {
    # A matrix or a two-way table of counts keeps its rows and columns.
    df <- if (is.data.frame(x)) x else as.data.frame(unclass(x), stringsAsFactors = FALSE)
    fact("Rows", nrow(df)); fact("Columns", ncol(df)); fact("Missing values", sum(vapply(df, function(v) sum(is.na(v)), 0)))
    out$table <- table_page(df, msg, if (is.matrix(x) && !is.null(rownames(x))) rownames(x) else NULL)
  } else if (kind == "model" && inherits(x, "htest")) {
    fact("Test", x$method); fact("Data", x$data.name)
    if (!is.null(x$statistic)) fact(names(x$statistic) %||% "Statistic", number(x$statistic))
    if (!is.null(x$parameter)) fact(paste(names(x$parameter), collapse = ", ") %||% "Parameter", number(x$parameter))
    fact("p-value", format.pval(x$p.value, digits = 4))
    if (!is.null(x$conf.int)) fact(paste0(100 * attr(x$conf.int, "conf.level"), "% interval"), paste(number(x$conf.int), collapse = " – "))
    if (!is.null(x$estimate)) for (k in seq_along(x$estimate)) fact(names(x$estimate)[k] %||% "Estimate", number(x$estimate[k]))
    fact("Alternative", x$alternative)
    out$text <- printed(x, limits, "As R prints it")
  } else if (kind == "model") {
    fact("Formula", tryCatch(paste(deparse(stats::formula(x)), collapse = " "), error = function(e) NULL))
    if (is.list(x$family)) fact("Family", paste0(x$family$family, " (", x$family$link, " link)"))
    fact("Observations", tryCatch(stats::nobs(x), error = function(e) NULL))
    s <- tryCatch(summary(x), error = function(e) NULL)
    if (inherits(x, "lm") && !inherits(x, "glm") && is.list(s)) { fact("R²", number(s$r.squared)); fact("Adjusted R²", number(s$adj.r.squared)) }
    fact("AIC", tryCatch(number(stats::AIC(x)), error = function(e) NULL))
    fact("BIC", tryCatch(number(stats::BIC(x)), error = function(e) NULL))
    fact("Log-likelihood", tryCatch(number(as.numeric(stats::logLik(x))), error = function(e) NULL))
    if (is.numeric(x$deviance)) fact("Residual deviance", paste(number(x$deviance), "on", x$df.residual, "df"))
    if (is.numeric(x$null.deviance)) fact("Null deviance", paste(number(x$null.deviance), "on", x$df.null, "df"))
    co <- tryCatch(stats::coef(s), error = function(e) NULL)
    if (is.null(dim(co))) co <- tryCatch({ k <- stats::coef(x); if (is.numeric(k)) cbind(Estimate = k) else NULL }, error = function(e) NULL)
    if (!is.null(dim(co))) { co <- as.data.frame(co); co[] <- lapply(co, function(v) if (is.numeric(v)) signif(v, 4) else v); out$table <- table_page(co, msg, rownames(co), each = TRUE) }
    out$text <- printed(if (is.null(s)) x else s, limits, "As R prints its summary")
  } else if (kind == "value") {
    out$values <- list(total = 1, offset = 0, items = list(list(name = NULL, value = cells(x, limits$maxText))))
  } else if (kind == "vector") {
    # A one-way table (counts by value) is read as its named counts.
    counts <- inherits(x, "table")
    v <- if (length(dim(x)) == 1) stats::setNames(as.vector(x), names(x)) else x; missing <- sum(is.na(v))
    fact("Length", length(v)); if (missing) fact("Missing", missing)
    if (counts) fact("Total", sum(v, na.rm = TRUE))
    else if (is.numeric(v) && length(v) > 1 && missing < length(v)) {
      q <- stats::quantile(v, c(0, .5, 1), na.rm = TRUE, names = FALSE)
      fact("Min", number(q[1])); fact("Median", number(q[2])); fact("Mean", number(mean(v, na.rm = TRUE))); fact("Max", number(q[3])); if (length(v) > 2) fact("SD", number(stats::sd(v, na.rm = TRUE)))
    }
    if (is.factor(v)) fact("Levels", nlevels(v))
    # A categorical vector reads best as its counts.
    if ((is.factor(v) || is.character(v) || is.logical(v)) && length(v) > 1 && length(v) <= limits$maxSortRows) {
      counts <- sort(table(v, useNA = "ifany"), decreasing = TRUE)
      df <- data.frame(value = names(counts), count = as.integer(counts), check.names = FALSE, stringsAsFactors = FALSE)
      fact("Distinct", nrow(df))
      first <- msg; first$offset <- 0; first$sort <- NULL
      out$table <- table_page(df, first)
    }
    total <- length(v); offset <- min(msg$offset, max(0, total - 1)); at <- if (total) seq(offset + 1, min(total, offset + msg$limit)) else integer(0)
    labels <- names(v)
    out$values <- list(total = total, offset = offset, items = lapply(at, function(i) list(name = if (is.null(labels)) NULL else labels[i], value = cells(v[i], limits$maxCellChars))))
  } else if (kind == "function") {
    source <- attr(x, "srcref"); lines <- if (!is.null(source)) as.character(source) else deparse(x)
    fact("Arguments", clip(paste(deparse(base::args(x))[1], collapse = " "), 200))
    text <- paste(lines, collapse = "\n"); cut <- nchar(text, type = "bytes") > limits$maxText
    out$text <- list(label = "Code", text = if (cut) substr(text, 1, limits$maxText) else text, cut = cut)
  } else if (kind == "other") out$text <- printed(x, limits, "As R prints it")
  p <- parts(x)
  if (!is.null(p) && kind != "table" && length(p$names)) {
    # A list pages its parts; anything else shows its first parts beside what it pages.
    total <- length(p$names); offset <- if (kind == "list") min(msg$offset, max(0, total - 1)) else 0
    at <- seq(offset + 1, min(total, offset + if (kind == "list") msg$limit else limits$maxChildren))
    out$children <- list(total = total, offset = offset, items = lapply(at, function(i) { v <- p$get(i)
      list(index = i - 1, name = if (nzchar(p$names[i])) p$names[i] else paste0("[[", i, "]]"), type = class(v)[1], size = size_of(v), summary = describe(v), expression = p$code(code, i)) }))
  }
  if (kind == "list" && is.null(out$children)) out$text <- printed(x, limits, "As R prints it")
  out$facts <- facts
  out
}
`%||%` <- function(a, b) if (is.null(a) || !length(a) || identical(a, "")) b else a
inspect <- function(msg) {
  reply <- function(x) emit(c(list(id = msg$id, kind = "inspected"), x))
  # A value that draws when printed (a ggplot) draws on a device of the reading's own, so the
  # session's plot is unchanged.
  before <- grDevices::dev.cur(); grDevices::pdf(NULL); mine <- grDevices::dev.cur()
  on.exit({ if (mine %in% grDevices::dev.list()) grDevices::dev.off(mine); if (before %in% grDevices::dev.list()) grDevices::dev.set(before) }, add = TRUE)
  tryCatch({
    if (!exists(msg$name, envir = globalenv(), inherits = FALSE)) return(reply(list(state = "missing", problem = paste(msg$name, "is not in the session."))))
    x <- get(msg$name, envir = globalenv(), inherits = FALSE); code <- sym(msg$name); trail <- list()
    for (step in unlist(msg$path)) {
      p <- parts(x)
      if (is.null(p) || step + 1 > length(p$names)) return(reply(list(state = "missing", problem = paste("That part is no longer in", code))))
      i <- step + 1; x <- p$get(i); code <- p$code(code, i)
      trail[[length(trail) + 1]] <- list(index = step, name = if (nzchar(p$names[i])) p$names[i] else paste0("[[", i, "]]"))
    }
    reply(list(state = "shown", object = suppressWarnings(suppressMessages(describe_value(x, msg, msg$name, code, trail)))))
  }, interrupt = function(e) reply(list(state = "timeout", problem = "Reading the value took too long and was stopped.")),
     error = function(e) reply(list(state = "failed", problem = conditionMessage(e))))
}

emit(list(kind = "ready", version = R.version.string, pid = Sys.getpid(), variables = variables(200)))
repeat {
  line <- tryCatch(readLines(input, n = 1), interrupt = function(e) NA)
  if (identical(line, NA)) next
  if (length(line) == 0) break
  msg <- jsonlite::fromJSON(line, simplifyVector = FALSE)
  if (identical(msg$op, "run")) tryCatch(run(msg), interrupt = function(e) say(list(id = msg$id, kind = "done", ok = FALSE, interrupted = TRUE, variables = variables(msg$maxVariables))))
  if (identical(msg$op, "inspect")) tryCatch(inspect(msg), interrupt = function(e) emit(list(id = msg$id, kind = "inspected", state = "timeout", problem = "Reading the value took too long and was stopped.")))
}
})
