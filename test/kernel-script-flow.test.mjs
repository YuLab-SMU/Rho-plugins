import assert from 'node:assert/strict';
import test from 'node:test';
import { looksLikePath, scriptFlow } from '@rho-workspace/plugin-kernel/code';

// Each step as its lines, what it makes (* changes a value made before, () a function) and what
// the lines into it come from.
const shape = flow => flow.steps.map(s => {
  const into = flow.links.filter(l => l.to === s.id).map(l => l.from.replace(/^(value|wrote):/, ''));
  return `${s.from}-${s.to} ${s.nodes.map(n => n.name + (s.changed.includes(n.name) ? '*' : '') + (s.functions.includes(n.name) ? '()' : '')).join(',')} <= ${into.join(' ')}${s.reads.length ? ' | ' + s.reads.join(' ') : ''}`;
});

const r = `library(dplyr)
d <- read.csv("data/plates.csv", fileEncoding = "UTF-8")
d$genotype <- factor(d$genotype,
                     levels = c("WT", "mut"))
d <- d[order(d$genotype), ]
cols <- c(WT = "#333", mut = "#c00")
label <- "Colony area"
contrast <- function(df, var, f = identity) {
  wt <- f(df[[var]][df$genotype == "WT"])
  sapply(levels(df$genotype), function(g) mean(f(df[[var]][df$genotype == g])) - mean(wt))
}
print(head(d))
area <- contrast(d, "area", log)
out <- file.path("results", "area.csv")
write.csv(data.frame(area), out)
p <- ggplot(d, aes(genotype, area, colour = genotype)) + scale_colour_manual(values = cols) + labs(y = label)
ggsave("results/area.png", p)
for (v in c("area", "circ")) total <- v
area -> kept
fit <- lm(area ~ genotype, data = d)
`;

test('an R script: each step, what it makes, what it reads from the steps before and the files it names', () => {
  assert.deepEqual(shape(scriptFlow(r, 'r')), [
    // The changes to d join the step that read it; a function's arguments and locals are its own.
    '2-5 d <=  | data/plates.csv',
    // Values made from nothing, one after another, are one step.
    '6-11 cols,label,contrast() <= ',
    '13-13 area <= contrast@6 d@2',
    // A path kept as a value is the file a call is given it for.
    '14-14 out <= ',
    '15-15 results/area.csv <= area@13 out@14',
    '16-16 p <= d@2 cols@6 label@6',
    '17-17 results/area.png <= p@16',
    '18-18 v,total <= ',
    '19-19 kept <= area@13',
    // Names in aes() and in a formula are columns of the table, not the script's values.
    '20-20 fit <= d@2',
  ]);
});

const py = `import pandas as pd
from pathlib import Path
OUT = "results/fit.csv"
aq = pd.read_csv("data/air.csv")
aq["hot"] = aq["Temp"] > 80
def fit(df, x, y="Ozone"):
    slope = df[x].corr(df[y])
    return slope
fits = {c: fit(aq, c) for c in ["Temp", "Wind"]}
table = pd.DataFrame(fits, index=[0])
table.to_csv(OUT)
print(table)
total = 0
for month, rows in aq.groupby("Month"):
    total += len(rows)
with open("results/notes.txt", "w") as fh:
    fh.write(str(total))
squares = [v * v for v in range(3)]
`;

test('a Python script: imports are not values; comprehensions, functions and loops keep their names', () => {
  assert.deepEqual(shape(scriptFlow(py, 'python')), [
    '3-3 OUT <= ',
    '4-5 aq <=  | data/air.csv',
    '6-8 fit() <= ',
    '9-9 fits <= fit@6 aq@4',
    '10-10 table <= fits@9',
    '11-11 results/fit.csv <= table@10 OUT@3',
    '13-13 total <= ',
    '14-15 month,rows,total* <= aq@4 total@13',
    '16-17 fh,results/notes.txt <= total@14',
    '18-18 squares <= ',
  ]);
});

test('a file read again after a step wrote it comes from that step; what a statement that makes nothing reads is kept', () => {
  const flow = scriptFlow('x <- 1\nwrite.csv(x, "out/x.csv")\ny <- read.csv("out/x.csv")\nprint(y)\n', 'r');
  assert.deepEqual(shape(flow), ['1-1 x <= ', '2-2 out/x.csv <= x@1', '3-3 y <= out/x.csv@2']);
  assert.equal(flow.quiet, 1);
  assert.deepEqual(flow.quietReads, [{ from: 4, to: 4, used: ['y'] }]);
  // Values there before the script (a cell's session values) are read until it makes its own.
  const cell = scriptFlow('fit <- lm(y ~ x, data = d)\nd <- d[1:2, ]\nz <- d', 'r', undefined, ['d']);
  assert.deepEqual(cell.outside, [{ name: 'd', to: 'lines:1' }, { name: 'd', to: 'lines:2' }]);
  assert.deepEqual(shape(cell), ['1-1 fit <= ', '2-2 d* <= ', '3-3 z <= d@2']);
});

test('strings name files only when they look like one; limits are counted', () => {
  assert.equal(looksLikePath('data/x.csv'), true);
  assert.equal(looksLikePath('x.rds'), true);
  for (const s of ['Wildtype', '%.2f', 'p.adjust', '#52514e', 'Welch tests (raw)', 'https://example.org/x.csv', 'e.g']) assert.equal(looksLikePath(s), false, s);
  const many = Array.from({ length: 5 }, (_, i) => `v${i} <- read.csv("d${i}.csv")`).join('\n');
  const cut = scriptFlow(many, 'r', { bytes: 1 << 20, steps: 3 });
  assert.deepEqual([cut.steps.length, cut.cut], [3, 2]);
  assert.equal(scriptFlow(many, 'r', { bytes: 10, steps: 3 }).tooLong, true);
});
