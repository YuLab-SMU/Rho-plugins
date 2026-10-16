# Ordinary project code. Uses base R; there is no Rho package or dataset dependency.
args <- commandArgs(TRUE)
out <- args[[1L]]
cat("entry\n", file=paste0(out, ".entries.jsonl"), append=TRUE)
stopifnot(!file.exists(out), dir.create(out))
data <- data.frame(sample_id=c("001", "002", "003", "NA"),
                   label=c("NA", "control", "中文", "treated"),
                   time=1:4, value=c(2, 4, 5, 9))
model <- lm(value ~ time, data=data)
write.csv(data, file.path(out, "observations.csv"), row.names=FALSE, na="")
write.csv(data.frame(record_id=data$sample_id, fitted=unname(fitted(model))),
          file.path(out, "fitted.csv"), row.names=FALSE, na="")
saveRDS(model, file.path(out, "model.rds"))
png(file.path(out, "response.png"), width=640, height=480)
plot(data$time, data$value, xlab="Time", ylab="Observed value")
abline(model)
dev.off()
pdf(file.path(out, "response.pdf"), width=8, height=6, useDingbats=FALSE)
plot(data$time, data$value, xlab="Time", ylab="Observed value")
abline(model)
dev.off()
writeLines(sprintf('{"classes":["lm"],"coefficients":[%.12g,%.12g],"observedRows":4}',
                   coef(model)[[1L]], coef(model)[[2L]]), file.path(out, "object.json"))
writeLines(capture.output(sessionInfo()), file.path(out, "sessionInfo.txt"))
