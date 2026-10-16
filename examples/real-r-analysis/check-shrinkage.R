argv <- commandArgs(TRUE)
out <- argv[[1L]]
cat("entry\n", file=paste0(out, ".entries.jsonl"), append=TRUE)
stopifnot(!file.exists(out), dir.create(out))
scope <- new.env(parent=globalenv())
scope$commandArgs <- function(...) c(argv[[2L]], file.path(out, "native.json"), argv[[4L]])
sys.source(argv[[3L]], envir=scope)
