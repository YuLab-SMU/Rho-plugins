argv <- commandArgs(TRUE)
out <- argv[[1L]]
cat("entry\n", file=paste0(out, ".entries.jsonl"), append=TRUE)
dir.create(out, showWarnings = FALSE)
stopifnot(dir.exists(out), length(list.files(out, all.files = TRUE, no.. = TRUE)) == 0L)
scope <- new.env(parent=globalenv())
scope$commandArgs <- function(...) c(argv[[2L]], file.path(out, "native.json"), argv[[4L]])
sys.source(argv[[3L]], envir=scope)
