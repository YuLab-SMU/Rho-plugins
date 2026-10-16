# Project-owned native check. Inputs are immutable resource snapshots.
args <- commandArgs(TRUE)
out <- args[[1L]]
cat("entry\n", file=paste0(out, ".entries.jsonl"), append=TRUE)
stopifnot(!file.exists(out), dir.create(out))
model <- readRDS(args[[2L]])
observed <- read.csv(args[[3L]], colClasses=c("character", "character", "numeric", "numeric"), na.strings="", check.names=FALSE)
stopifnot(identical(observed$sample_id, c("001", "002", "003", "NA")),
          observed$label[[1L]] == "NA", inherits(model, "lm"),
          isTRUE(all.equal(unname(coef(model)), c(-0.5, 2.2), tolerance=1e-10)))
writeLines('{"state":"passed","scope":"Saved lm coefficients and declared sample identities; base R project check."}',
           file.path(out, "check.json"))
