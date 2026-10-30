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

run <- function(msg) {
  id <- msg$id; plots <- list(); ok <- TRUE; interrupted <- FALSE
  # Plots are recorded on a device that draws nothing, after each top-level expression, and
  # drawn to files at the end; a device the code opens itself is its own.
  grDevices::pdf(NULL, width = 7, height = 5); grDevices::dev.control("enable")
  device <- grDevices::dev.cur(); seen <- NULL
  snapshot <- function() {
    if (!(device %in% grDevices::dev.list())) return()
    current <- grDevices::dev.cur(); if (current != device) grDevices::dev.set(device)
    p <- grDevices::recordPlot()
    if (current != device) grDevices::dev.set(current)
    if (length(p[[1]]) && !(length(seen) && same(p[[1]], seen))) { plots[[length(plots) + 1]] <<- p; seen <<- p[[1]] }
  }
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
  shown <- final_plots(plots)
  for (i in seq_along(shown)) {
    if (i > msg$maxPlots) break
    file <- file.path(msg$plots, paste0(id, "-", i, ".png"))
    grDevices::png(file, width = 7, height = 5, units = "in", res = 144)
    tryCatch(grDevices::replayPlot(shown[[i]]), error = function(e) NULL)
    grDevices::dev.off()
    say(list(id = id, kind = "plot", file = file, width = 1008, height = 720))
  }
  if (device %in% grDevices::dev.list()) grDevices::dev.off(device)
  say(list(id = id, kind = "done", ok = ok, interrupted = interrupted, variables = variables(msg$maxVariables)))
}

emit(list(kind = "ready", version = R.version.string, pid = Sys.getpid(), variables = variables(200)))
repeat {
  line <- tryCatch(readLines(input, n = 1), interrupt = function(e) NA)
  if (identical(line, NA)) next
  if (length(line) == 0) break
  msg <- jsonlite::fromJSON(line, simplifyVector = FALSE)
  if (identical(msg$op, "run")) tryCatch(run(msg), interrupt = function(e) say(list(id = msg$id, kind = "done", ok = FALSE, interrupted = TRUE, variables = variables(msg$maxVariables))))
}
})
