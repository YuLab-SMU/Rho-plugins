# Explicit project orchestration of the existing independent/native checkers.
rho_check_args <- commandArgs(TRUE)
rho_check_output <- rho_check_args[[1L]]
cat("entry\n", file=paste0(rho_check_output, ".entries.jsonl"), append=TRUE)
stopifnot(!file.exists(rho_check_output), dir.create(rho_check_output))
scope <- new.env(parent=globalenv())
scope$out <- NULL # The original checker assigns out with <<- inside main().
scope$commandArgs <- local({ frozen <- c(rho_check_args[[2L]], file.path(rho_check_output, "native.json")); function(...) frozen })
sys.source(rho_check_args[[3L]], envir=scope)
status <- system2("python3", c(shQuote(rho_check_args[[4L]]), shQuote(rho_check_args[[2L]]), "--report", shQuote(file.path(rho_check_output, "arithmetic.json"))))
stopifnot(status == 0L)
