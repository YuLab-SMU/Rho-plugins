# Real R analysis: paired dexamethasone response

This consumer belongs to the R/scientific owner in Rho-plugins. It uses an actual
R process, the public airway RNA-seq data and DESeq2. Core contributes process
holding, request identity, bounded output and continuation through its existing
CLI; the scientific component owns the method and interpretation.

The [fact acceptance](ACCEPTANCE.md) records the actual 2026-10-11 execution,
numerical observations, original failures and verified limits.

The question is whether dexamethasone changes gene expression in cultured human
airway smooth muscle cells after accounting for donor differences, and whether
the response estimates depend strongly on one donor. The public experiment has
four donors, each with one treated and one untreated sample. The analysis uses
the eight samples with no albuterol treatment, as distributed by airway, rather
than treating samples from one donor as independent biological replicates.
It also asks how the six declared response estimates vary under repeated count
sampling from the fitted negative-binomial model, with these same donors and
design held fixed.

## Data and method

The installed `airway` dataset supplies 63,677 genes × 8 samples and 175,516,423
raw integer counts. Sample identities, annotations, treatment and donor pairings
are exported before fitting. Its provenance is
[GSE52778](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE52778),
[Himes et al., PLOS ONE 2014](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0099625),
and the [airway data vignette](https://bioconductor.org/packages/release/data/experiment/vignettes/airway/inst/doc/airway.html).
The full reads are not realigned here: these are the package's documented gene
counts and annotation, whose provenance differs from the original paper's exact
quantification pipeline. The original paper's 316-gene count is not a target
value for this reanalysis.

The main fit uses a donor-adjusted negative-binomial model, `~ cell + dex`, with
an explicit treated-versus-untreated contrast. This design and the airway input
appear in the [official DESeq2 vignette](https://bioconductor.org/packages/release/bioc/vignettes/DESeq2/inst/doc/DESeq2.html).
The installed DESeq2 1.48.2 vignette was also checked; the latest web vignette
does not establish the local version. Counts of at least 10 in at least four
original samples retain 16,139 genes. Four additional fits each omit one donor
pair and retain this same gene universe. Their purpose is to examine sensitivity
to individual donors, with six samples and fewer residual degrees of freedom.

All five fits use serial DESeq2 Wald tests, ratio size factors, the parametric
dispersion fit and no coefficient prior. Results use two-sided tests of zero
log2 fold change and Benjamini-Hochberg adjustment at 0.05. Independent filtering
is explicitly disabled after the stated prefilter so an independent checker can
recompute BH over the reported finite p-values. Default Cook's-distance handling
is retained, and unavailable p-values remain unavailable. The analysis does not
replace them with zeros or count them as nonsignificant completed tests.

CRISPLD2, DUSP1, FKBP5, KLF15, PER1 and TSC22D3 are declared in advance as known
glucocorticoid-response observations to inspect. The original study provides
evidence of induction in these cell lines. Their positive direction is a useful
external expectation, not a hard-coded analysis result. The script exports the
actual estimates and each donor omission, including disagreement. Donor omission
is descriptive sensitivity, not an additional independent replication or a new
population-level p-value.

The sample PCA is a descriptive plot of `log2(normalized count + 1)`, explicitly
labeled in the figure. It does not use a variance-stabilizing transformation;
its separation alone is not a test of treatment response or model adequacy.

The main fitted means and dispersions parameterize 200 count simulations by
default. Every simulation includes all 16,139 retained genes and all eight
samples; it is refitted with the same DESeq2 procedure and treated-versus-untreated
contrast. Normalization, dispersion estimation and coefficient fitting are
repeated, while the gene universe is held fixed. This makes the repetition a
statistical uncertainty calculation rather than an artificial delay. The
[official R negative-binomial documentation](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/NegBinomial.html)
defines the `mu`, `size` parameterization: the script uses the full-fit mean as
`mu` and reciprocal dispersion as `size`, giving variance
`mu + dispersion * mu^2`. The exact local R help was checked alongside the
DESeq2 model documentation.

For each declared gene, the exports report the simulated effect estimates,
two-sided p-values, BH-adjusted p-values, convergence, 2.5%/50%/97.5% effect
quantiles and direction frequencies. Quantiles and direction frequencies use
only finite estimates whose coefficient fit converged; exclusions are explicit.
The RNG is Mersenne-Twister/Inversion/Rejection with seed 52778. The resulting
range describes conditional count-sampling variation under this fitted model.
It is not a confidence interval for the donor population or clinical response.
Independent gene simulation does not preserve biological gene correlation;
simulation results do not replace the real-data analysis, establish new
biological replication, or check whether the assumed count model is correct.

## Execution and limits

The script requires existing R packages `airway`, `DESeq2`,
`SummarizedExperiment`, `jsonlite` and `digest`. It does not install packages,
download data, contact another session or read private project data.

```sh
/usr/local/bin/Rscript --vanilla examples/real-r-analysis/analyze.R /absolute/new/project/analysis-output 200
```

The parent directory must exist and the output directory must be new. The script
is self-contained: the whole file can be supplied to `rho-core submit --code-file`
and executed from Core's immutable code snapshot. Configure the executor as the
absolute `Rscript` path with `--executor-arg r=--vanilla`; pass the output directory
after the submit command's `--` separator. The CLI's public contract and receipt
must be read by the caller, who retains the request identity.

The input contract fixes the native workload to 509,416 count observations,
16,139 fitted genes, five real-data fits and the requested number of simulated
fits, with one R process and no parallel workers. The optional second script
argument selects 1–1,000 simulations; its default is 200. Each simulated matrix
and fitted object is discarded after its summaries are exported; the script
does not retain 200 fitted model objects. It retains one complete simulated
matrix, the fitted simulation parameters and six-marker observations per
simulation, keeping the retained simulation workload proportional to the
explicit replicate limit.
An unexpected shape, pairing, prefilter count or invalid count fails before
fitting. These are dataset-identity and workload checks, not an OS memory
sandbox or a disk quota. Artifact byte sizes are recorded in the manifest.
Core's actual limits are obtained from `capability`. The consumer's explicit
managed-computation time budget defaults to 1,800 seconds and is configurable
from 30 to 7,200 seconds; exhaustion requests cancellation and retains incomplete
evidence. This budget does not bound native input preparation, artifact copying
or subsequent verification; each CLI observation has its own bounded call.
There is no added sleep. The output records the elapsed time of every fit and
the full execution. Runtime is an observed result of the selected environment,
not an assumed acceptance threshold.

From the Rho-plugins repository root, the supplied consumer starts its own
disposable Host, submits the script, interrupts only its wait client, reconnects
to the same request, checks duplicate delivery and retrieves the artifacts:

```sh
python3 examples/real-r-analysis/run.py --binary /absolute/rho-core --root /private/tmp/rho-airway-new --timeout 1800
```

`--root` must be new. The consumer records a Core-free input read from the
installed package before submission; this is an independent data baseline, not
a second full statistical run. After successful completion it invokes the
independent checker on both original and retrieved files. The checker can also
be run directly:

```sh
python3 examples/real-r-analysis/verify.py /private/tmp/rho-airway-new/retrieved --report /private/tmp/rho-airway-new/evidence/manual-verification.json
```

Saved model state has a separate native observation command:

```sh
/usr/local/bin/Rscript --vanilla examples/real-r-analysis/inspect-models.R /private/tmp/rho-airway-new/retrieved /private/tmp/rho-airway-new/evidence/native-model-observation.json
```

The report path must be new, its parent must exist, and it must be outside the
artifact directory. This command reads all five saved models, checks every
selected raw count and donor pair, reads native size factors/dispersion/convergence,
and calls `results()` on stored coefficients to compare all six exported result
columns at tolerance 1e-9. It also compares all stored full-fit means and
dispersions with the simulation parameters. It records the actual package
versions and requires the native observation packages to match the analysis
session. It does not refit a model. This is an observation using the same R
packages, separate from the independent Python arithmetic checker; it is not an
independent statistical oracle. Check failures exit nonzero and write a failed
JSON report when a safe report destination and `jsonlite` are available.

## Artifacts and completion

Each script entry appends a JSON line to `<output-directory>.entries.jsonl`
before checking whether the output directory exists. Re-entry is visible even
when existing artifacts cause execution to stop. This is the native launch
observation for duplicate-submission checks; it is not an external exactly-once
guarantee.

| Artifact | Content |
| --- | --- |
| `input/counts.csv` | Original raw integer matrix; `gene_id` followed by eight sample columns |
| `input/samples.csv` | Ordered `sample_id`, donor `cell`, `dex`, `albut` and original sample metadata |
| `input/genes.csv`, `input/prefilter.csv` | Original gene annotation and one Boolean `kept` per original gene |
| `results/full.csv`, `results/without_<donor>.csv` | `gene_id`, `symbol`, `baseMean`, `log2FoldChange`, `lfcSE`, `stat`, `pvalue`, `padj`, `dispersion`, `beta_converged`, `max_cooks` |
| `models/<analysis-id>.rds` | Actual fitted DESeq2 objects, preserving counts, design and fitted native state |
| `analysis_plan.csv` | Each model's donor omission, dimensions, design rank, residual degrees of freedom, exact settings and elapsed time |
| `normalization.csv` | Each model's sample identity, size factor and raw filtered-count library size |
| `known_genes.csv`, `sensitivity.csv` | Actual known-response estimates and per-gene direction/significance sensitivity |
| `plots/qc-and-response.pdf` | MA plot, sample PCA, and paired normalized counts for the six declared genes |
| `bootstrap/plan.json`, `bootstrap/means.csv`, `bootstrap/dispersion.csv` | Simulation settings/RNG, all full-fit gene/sample means, and all full-fit gene dispersions |
| `bootstrap/first-simulated-counts.csv`, `bootstrap/marker-counts.csv` | One complete simulated raw count matrix and the six-marker raw counts in every simulation |
| `bootstrap/replicates.csv`, `bootstrap/markers.csv` | Replicate dimensions, count digest/sum, elapsed time, missing tests/convergence, and six-marker effect/test estimates |
| `bootstrap/summary.csv`, `bootstrap/marker-distributions.pdf` | Explicit retained/excluded denominators, effect quantiles, direction frequencies and six effect-distribution plots |
| `sessionInfo.txt`, `versions.csv` | Actual R session, versions and loaded installed-package paths |
| `summary.json`, `artifact_manifest.csv` | Settings and observed facts, plus SHA-256/byte sizes of existing artifacts |
| `complete.json` | Published last, with summary and manifest SHA-256, only after all analysis and exports succeed |

The manifest lists the ordinary scientific/session files; it excludes itself
and the final completion marker to avoid circular digests. The checker requires
the exact file inventory and verifies the marker's manifest/summary references.

Stage progress is emitted as short JSON lines on stdout. Messages and warnings
remain on stderr. A handled error writes `failure.json`, exits nonzero and does
not publish the completion marker. Abrupt native termination may leave partial
files without `failure.json`; neither partial files nor an exit code by itself
establish a complete result. `complete.json` is a completion declaration whose
referenced bytes and scientific facts must still be checked independently.

An interrupted **wait client** can reconnect to the same request and native R
execution while the Host remains alive. This batch execution is a real R session
during its lifetime, and fitted state is retained as RDS afterward. It does not
claim a live interactive R session after the process ends, nor reattachment to
R memory after Host replacement. Host crashes, R crashes, cancelled calculations
and operating-system reboots are different experiments.

## Acceptance boundary

Operational acceptance must retain the public CLI receipts: original code and
request digest, accepted run identity, wait-client interruption, continued held
execution, the same run on subsequent lookup/wait, duplicate delivery without a
second native entry, real terminal/exit and release facts, and retained output.
Large scientific artifacts stay in the selected project and are read with
existing file tools; Core's bounded stdout is not a file-artifact service.

Scientific fact checks must independently read the installed public source and
exported matrix, compare exact input identities, validate sample pairing and
model dimensions, recompute the prefilter, size-factor arithmetic, base means,
Wald normal-tail p-values and BH adjustment, and compare the native fitted model
with the exported results. They should report the actual known-gene directions,
each leave-one-donor-out estimate and disagreements, and inspect the figure.
For simulations they should check the exported parameter identities against the
real fit, fixed sample/gene universe, replicate count, convergence/NA accounting,
and independently recompute marker quantiles and direction counts. The Python
checker validates exported file and arithmetic consistency; it does not rerun
DESeq2 or serve as an independent statistical oracle. Checking an RDS object's
contents is a separate native observation. Arithmetic consistency and external
expectations do not independently validate every negative-binomial assumption
or estimate.

The scientific owner must review the chosen counts, model, outliers, donor
sensitivity, figure and interpretation. No automated success marker substitutes
for that review. This is a public-data reanalysis of four cultured donor cell
lines. Patient clinical response, new wet-lab validation and application
integration are outside this analysis's acceptance. Observed gaps determine
subsequent component work.

## Rejected artifact counterexamples

The following command creates one disposable copy at a time, records checker
failures and removes only its own altered copy. It preserves the source artifacts.
It requires a fresh output root and enough space for one additional artifact tree.

```sh
python3 examples/real-r-analysis/check-failures.py /absolute/verified/artifacts --root /absolute/new/negative-checks
```

The cases alter a file's bytes, remove the completion marker, and falsify a BH
value while updating all affected digests. The last case must pass byte integrity
and fail independent arithmetic. A failed checker writes a structured report
outside the artifact directory; counterexamples do not turn the original result
into a new statistical run.
