# Paired airway analysis acceptance

Recorded execution: 2026-10-11. The research question concerns dexamethasone
transcriptional response in four cultured human airway smooth-muscle donor cell
lines, adjusted for donor differences, and sensitivity to one donor and conditional
count variation. [README](README.md) defines data, method, provenance and commands.
The domain consumer performed the analysis through the public Core CLI, with an
external Codex Agent operating that interface.

## Execution and continuation

- Installed airway 1.28.0 supplied 63,677 × 8 integer counts, four treated/untreated
  donor pairs and 175,516,423 total counts. The independently read full matrix
  outside Core and managed-analysis export had identical SHA-256, beyond matching
  dimensions or sums. FASTQ reads were not realigned.
- R 4.5.2 and DESeq2 1.48.2 ran the main `~ cell + dex` analysis, four donor-omission
  fits and 200 negative-binomial simulations/refits over 16,139 genes × 8 samples.
  Actual R execution was 562.6595 seconds, about 9 minutes 23 seconds, without delay
  padding.
- Request `dex-paired-bootstrap-001`, run `18dd91c642960ec0-44421.1`, R PID 44427.
  The SIGTERM-interrupted wait client exited -15; lookup still found that active
  run/PID. Same-identity submit during and after execution returned `existing`.
  Exactly one native entry was observed, with no redispatch or reconstructed result.
- Accepted script and artifact-record digest:
  `5d4e1c20a4f6cf468ead65d5656729e0cb69e4df0562e65eeaf22a22e32024a9`.
  Terminal state was Code 0, released, no `unsaved`; stdout 36,080 bytes and stderr
  7,600 bytes were retained/read completely, both EOF and non-lossy.
- Original and retrieved artifacts each passed 12/12 independent checks. The tree
  contained 33 files: 31 manifested artifacts totaling 183,546,739 bytes, plus
  manifest and completion marker. The owned Host exited normally, without forced
  termination or unconfirmed/open requests; its socket was removed.

Local evidence is at `target/real-r-analysis/airway-03/`: `analysis.R`,
`entries.jsonl`, original CLI receipts and both checker reports in `evidence/`,
retrieved `artifacts/` and failed counterexamples in `negative-checks/`.
The original experiment root was `/private/tmp/rho-airway-03`.
Ignored local files are not published or permanent remote archives; this record
retains independently readable observations and limits.

## Numerical observations

The fixed prefilter retained 16,139 genes. Every main-analysis gene had a p-value
and converged coefficient fit; 4,068 had BH-adjusted p < 0.05. The independent
Python checker recomputed ratio normalization and baseMean for all five models,
Wald statistics, normal two-tail p-values and BH from exported LFC/SE/p-values,
and checked pairing, gene universe and sensitivity summaries.

All 4,068 significant main-analysis genes retained direction in all four
leave-one-donor-out fits; 2,056 remained BH < 0.05 in all four. Stable direction
does not establish stable precision or independent replication. All six declared
response genes converged and had positive effects in all five real-data fits.

| Gene | Main log2 fold change | Conditional 2.5% | Conditional 97.5% | Finite/converged out of requested | Positive estimates |
| --- | --- | --- | --- | --- | --- |
| CRISPLD2 | 2.6273 | 2.2756 | 2.9975 | 200/200 | 200 |
| DUSP1 | 2.9439 | 2.7054 | 3.1518 | 200/200 | 200 |
| FKBP5 | 4.0427 | 3.4130 | 4.6429 | 200/200 | 200 |
| KLF15 | 4.4553 | 4.0433 | 4.8764 | 200/200 | 200 |
| PER1 | 3.1878 | 2.8741 | 3.5041 | 200/200 | 200 |
| TSC22D3 | 3.1862 | 2.5122 | 3.8937 | 200/200 | 200 |

CRISPLD2 main-analysis BH was 1.6263 × 10^-45; donor-omission log2 fold changes
ranged 2.4769–2.8861. Direction matched the original study's observations, without
becoming a discovery acceptance threshold. The original paper's 316-gene result
from a different quantification pipeline was not this analysis's target.

## Scientific and verification limits

Conditional quantiles use the fixed four donors and fitted means/dispersions with
independent gene count simulations. They are not donor-population or clinical
confidence intervals, add no biological replication, and validate neither the
negative-binomial assumption nor gene correlation structure.

Independent checks compared 64,556 fitted means, the first full simulated matrix
digest and 1,200 marker records' Wald values, type-7 quantiles and direction counts.
They did not independently refit DESeq2, replay the R RNG, recompute each
simulation's whole-gene BH or recompute the remaining 199 matrix digests whose
complete matrices were not exported.

Separate native observation read five RDS models with the same R/package versions.
All 121/121 checks passed: full counts, pairing, design, normalization, dispersion,
coefficient convergence and six native result columns matched CSV exports. Stored
full-fit means/dispersions matched simulation parameters. This is native
observation, not an independent statistical oracle.

All four scientific figure pages were inspected. MA boundary triangles indicated
points beyond display limits. PCA was explicitly `log2(normalized count + 1)`:
PC1 33.5%, PC2 25.0%, with visible N080611 donor difference. All six paired-gene
count plots increased; simulation figures used red main estimates and blue dashed
conditional quantiles. No missing glyphs, clipping or overlap were observed.
PCA donor differences did not trigger post-hoc sample removal.

## Failed attempts and rejected counterexamples

- Attempt 01: the disposable Host could not bind its socket in the sandbox; managed
  analysis did not begin. Startup failure evidence remains retained.
- Attempt 02: five actual fits took 20.348 seconds, below that experiment's long-task
  requirement. Same-task continuation and single native entry succeeded, but the
  driver failed during finalization because the checker file was not ready.
  Later 11/11 checks of its original artifacts did not erase that driver failure
  or rerun the request. Attempt 03 used a new request for added simulation work.
- Three independent altered copies exited 1: modified bytes, deleted `complete`,
  and a falsified BH value with all affected file/manifest/completion digests
  updated. The final case passed byte integrity and failed independent BH
  arithmetic. Original artifacts were unchanged and failure reports retained.

Acceptance covers actual batch analysis, wait continuation, recorded provenance,
readable artifacts and the numerical scope above. It does not establish interactive
R-memory recovery, R recovery after Host crash or complete application integration.
Researchers retain responsibility for further applicability of the public data.

## Component follow-up

The observed finalization gap was checker preparation order; startup preflight
now checks the verifier. No shared Core gap was demonstrated. The separately
executed native-model observation was subsequently added to the driver without
rerunning the 200 fits; original full-driver receipts retain their actual version.

R batch recipes and artifact integrity/provenance/retrieval remain concrete domain
responsibilities. Rscript, RDS, manifests and ordinary files supported this flow.
New session or retention mechanisms require a concrete missing guarantee.
[Roadmap](../../docs/ROADMAP.md#scientific-component-work) selects the integrated
application flow; this record does not accept that future composition.
