#!/usr/bin/env python3
"""Independently check exported airway artifacts using Python's standard library.

No R package, worker function, model invocation, or fitted R object is executed.
These checks establish file and arithmetic consistency, not new biological
replication, the correctness of upstream alignment, or clinical causality.
"""
import argparse
import csv
import hashlib
import json
import math
import re
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

SAMPLES = {
    "SRR1039508": ("N61311", "untrt", 20637971),
    "SRR1039509": ("N61311", "trt", 18809481),
    "SRR1039512": ("N052611", "untrt", 25348649),
    "SRR1039513": ("N052611", "trt", 15163415),
    "SRR1039516": ("N080611", "untrt", 24448408),
    "SRR1039517": ("N080611", "trt", 30818215),
    "SRR1039520": ("N061011", "untrt", 19126151),
    "SRR1039521": ("N061011", "trt", 21164133),
}
MARKERS = {
    "ENSG00000103196": "CRISPLD2", "ENSG00000120129": "DUSP1",
    "ENSG00000096060": "FKBP5", "ENSG00000163884": "KLF15",
    "ENSG00000179094": "PER1", "ENSG00000157514": "TSC22D3",
}
DONORS = sorted({x[0] for x in SAMPLES.values()})
FITS = ["full"] + ["without_" + d for d in DONORS]
SOURCES = {
    "input": "https://bioconductor.org/packages/release/data/experiment/vignettes/airway/inst/doc/airway.html",
    "methods": "https://bioconductor.org/packages/release/bioc/manuals/DESeq2/man/DESeq2.pdf",
    "paired_design": "https://bioconductor.org/packages/release/bioc/vignettes/DESeq2/inst/doc/DESeq2.html#can-i-use-deseq2-to-analyze-paired-samples",
    "published_direction": "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0099625",
    "BH": "https://stat.ethz.ch/R-manual/R-devel/library/stats/html/p.adjust.html",
    "NB_parameterization": "https://stat.ethz.ch/R-manual/R-devel/library/stats/html/NegBinomial.html",
    "type7_quantile": "https://stat.ethz.ch/R-manual/R-devel/library/stats/html/quantile.html",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def number(value):
    if value in ("", "NA", None):
        return None
    result = float(value)
    require(math.isfinite(result), "non-finite number: " + str(value))
    return result


def integer(value):
    require(bool(re.fullmatch(r"0|[1-9][0-9]*", value)), "invalid nonnegative integer: " + str(value))
    return int(value)


def close(actual, expected, label, probability=False):
    if actual is None or expected is None:
        require(actual is expected, label + ": NA mismatch")
        return
    require(math.isclose(actual, expected, rel_tol=1e-7 if probability else 1e-9,
                         abs_tol=5e-324 if probability else 1e-10),
            f"{label}: exported {actual!r}, recomputed {expected!r}")


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def read_csv(path, columns=()):
    with path.open(newline="", encoding="utf-8") as stream:
        reader = csv.DictReader(stream)
        require(reader.fieldnames is not None, f"missing CSV header: {path.name}")
        require(len(set(reader.fieldnames)) == len(reader.fieldnames), f"duplicate CSV columns: {path.name}")
        require(set(columns) <= set(reader.fieldnames), f"missing required CSV columns: {path.name}")
        rows = list(reader)
    require(all(None not in row and all(v is not None for v in row.values()) for row in rows),
            f"malformed CSV row: {path.name}")
    return rows


def unique(rows, key, label):
    indexed = {row[key]: row for row in rows}
    require(len(indexed) == len(rows), label + ": duplicate " + key)
    return indexed


def bh(pvalues):
    """BH step-up adjustment; NA values retain NA and are not hypotheses."""
    present = sorted((p, i) for i, p in enumerate(pvalues) if p is not None)
    result = [None] * len(pvalues)
    running = 1.0
    for rank in range(len(present), 0, -1):
        p, i = present[rank - 1]
        running = min(running, p * len(present) / rank)
        result[i] = running
    return result


def quantile7(values, probability):
    """R's type-7 linear interpolation, independently implemented."""
    if not values:
        return None
    ordered = sorted(values)
    h = (len(ordered) - 1) * probability
    lower = math.floor(h)
    return ordered[lower] + (h - lower) * (ordered[min(lower + 1, len(ordered) - 1)] - ordered[lower])


class Verifier:
    def __init__(self, out):
        self.out = out
        self.checks = []
        self.results = {}
        self.sf = {}
        self.summary = {}

    def check(self, name, action, limitation):
        try:
            evidence = action()
            self.checks.append(dict(check=name, status="pass", evidence=evidence, limitation=limitation))
        except Exception as exc:
            self.checks.append(dict(check=name, status="fail", error=str(exc), limitation=limitation))

    def integrity(self):
        manifest = read_csv(self.out / "artifact_manifest.csv", ("path", "bytes", "sha256"))
        records = unique(manifest, "path", "manifest")
        found = set()
        for path in self.out.rglob("*"):
            require(not path.is_symlink(), f"symlink is not an artifact: {path.relative_to(self.out)}")
            if path.is_file():
                found.add(path.relative_to(self.out).as_posix())
        expected = set(records) | {"artifact_manifest.csv", "complete.json"}
        require(found == expected, f"artifact inventory mismatch: missing={sorted(expected-found)}, unlisted={sorted(found-expected)}")
        required = {"input/counts.csv", "input/samples.csv", "input/genes.csv", "input/prefilter.csv",
                    "analysis_plan.csv", "normalization.csv", "known_genes.csv", "sensitivity.csv",
                    "summary.json", "sessionInfo.txt", "versions.csv", "plots/qc-and-response.pdf"}
        required |= {f"results/{fit}.csv" for fit in FITS} | {f"models/{fit}.rds" for fit in FITS}
        require(required <= set(records), f"missing required products: {sorted(required-set(records))}")
        for name, row in records.items():
            parts = PurePosixPath(name)
            require(not parts.is_absolute() and ".." not in parts.parts and name == parts.as_posix(), f"unsafe manifest path: {name}")
            path = self.out / name
            require(path.resolve().is_relative_to(self.out), f"manifest escapes output: {name}")
            require(integer(row["bytes"]) == path.stat().st_size, f"artifact size mismatch: {name}")
            require(re.fullmatch(r"[0-9a-f]{64}", row["sha256"]) is not None, f"invalid SHA256: {name}")
            require(sha256(path) == row["sha256"], f"artifact SHA256 mismatch: {name}")
        complete = json.loads((self.out / "complete.json").read_text())
        require(complete.get("schema_version") == 1 and complete.get("state") == "complete", "missing successful completion marker")
        for name in ("summary", "manifest"):
            file = "summary.json" if name == "summary" else "artifact_manifest.csv"
            require(complete.get(name + "_sha256") == sha256(self.out / file), f"completion marker {name} digest mismatch")
        require((self.out / "plots/qc-and-response.pdf").read_bytes().startswith(b"%PDF-"), "QC figure is not a PDF")
        self.summary = json.loads((self.out / "summary.json").read_text())
        return dict(files=len(found), manifest_entries=len(records), bytes=sum(integer(r["bytes"]) for r in manifest),
                    manifest_sha256=sha256(self.out / "artifact_manifest.csv"), completion_state="complete")

    def inputs(self):
        rows = read_csv(self.out / "input/counts.csv", ["gene_id"] + list(SAMPLES))
        require(len(rows) == 63677, f"input gene count {len(rows)} != 63677")
        self.counts = unique(rows, "gene_id", "counts")
        require(set(rows[0]) == {"gene_id"} | set(SAMPLES), "unexpected count-matrix columns")
        self.sample_ids = list(rows[0])[1:]
        require(self.sample_ids == list(SAMPLES), "count matrix sample order mismatch")
        totals = dict.fromkeys(self.sample_ids, 0)
        self.kept = []
        for gene, row in self.counts.items():
            require(re.fullmatch(r"ENSG[0-9]{11}", gene) is not None, f"invalid gene identifier: {gene}")
            values = [integer(row[s]) for s in self.sample_ids]
            self.counts[gene] = values
            for sample, value in zip(self.sample_ids, values):
                totals[sample] += value
            if sum(value >= 10 for value in values) >= 4:
                self.kept.append(gene)
        require(len(self.kept) == 16139, f"independent prefilter kept {len(self.kept)} != 16139")
        for sample, (_, _, expected) in SAMPLES.items():
            require(totals[sample] == expected, f"public-input library total mismatch: {sample}")
        sample_rows = read_csv(self.out / "input/samples.csv", ("sample_id", "cell", "dex", "albut", "Run"))
        self.samples = unique(sample_rows, "sample_id", "samples")
        require(set(self.samples) == set(SAMPLES), "sample metadata identities mismatch")
        for sample, (donor, dex, _) in SAMPLES.items():
            row = self.samples[sample]
            require((row["cell"], row["dex"], row["albut"], row["Run"]) == (donor, dex, "untrt", sample), f"sample pairing mismatch: {sample}")
        filters = unique(read_csv(self.out / "input/prefilter.csv", ("gene_id", "kept")), "gene_id", "prefilter")
        require(set(filters) == set(self.counts), "prefilter gene identities mismatch")
        kept = set(self.kept)
        for gene, row in filters.items():
            require(row["kept"] == ("TRUE" if gene in kept else "FALSE"), f"prefilter mismatch: {gene}")
        self.genes = unique(read_csv(self.out / "input/genes.csv", ("gene_id", "symbol")), "gene_id", "annotation")
        require(set(self.genes) == set(self.counts), "annotation identities mismatch")
        for gene, symbol in MARKERS.items():
            require(self.genes[gene]["symbol"] == symbol, f"marker annotation mismatch: {gene}")
        return dict(genes=len(self.counts), samples=len(self.samples), donors=DONORS, paired_samples_per_donor=2,
                    total_counts=sum(totals.values()), library_totals=totals, prefilter_kept=len(self.kept),
                    filter="count >= 10 in >= 4 original samples; fixed gene universe")

    def plans(self):
        plan = unique(read_csv(self.out / "analysis_plan.csv", ("analysis_id", "omitted_donor", "design", "contrast")), "analysis_id", "plan")
        require(set(plan) == set(FITS), "analysis identities must be full + four donor omissions")
        for fit, row in plan.items():
            omitted = "" if fit == "full" else fit.removeprefix("without_")
            donors = 4 if fit == "full" else 3
            require(row["omitted_donor"] == omitted, f"omitted donor mismatch: {fit}")
            values = {"n_donors": donors, "n_samples": 2*donors, "n_genes": 16139,
                      "design_rank": donors+1, "residual_df": donors-1}
            for field, expected in values.items():
                require(integer(row[field]) == expected, f"plan {field} mismatch: {fit}")
            strings = {"design": "~ cell + dex", "coefficient": "dex_trt_vs_untrt", "contrast": "dex:trt:untrt",
                       "test": "Wald", "fit_type": "parametric", "sf_type": "ratio", "beta_prior": "FALSE", "independent_filtering": "FALSE", "cook_policy": "DESeq2 default", "p_adjust_method": "BH"}
            for field, expected in strings.items():
                require(row[field] == expected, f"plan {field} mismatch: {fit}")
            close(number(row["alpha"]), .05, f"{fit} alpha")
            require(number(row["elapsed_seconds"]) > 0, f"missing real fit elapsed time: {fit}")
        self.plan = plan
        normalizations = read_csv(self.out / "normalization.csv", ("analysis_id", "sample_id"))
        require(len(normalizations) == 32 and {r["analysis_id"] for r in normalizations} == set(FITS), "normalization inventory must contain full 8 + four LODO 6 sample rows")
        return dict(fits=len(plan), fit_ids=FITS, full_design_rank=5, lodo_design_rank=4,
                    fit_elapsed_seconds={fit: number(row["elapsed_seconds"]) for fit, row in plan.items()})

    def numerical(self, fit):
        ids = [s for s in self.sample_ids if fit == "full" or self.samples[s]["cell"] != fit.removeprefix("without_")]
        indices = [self.sample_ids.index(s) for s in ids]
        ratio_logs = [[] for _ in ids]
        for gene in self.kept:
            values = [self.counts[gene][i] for i in indices]
            if all(value > 0 for value in values):
                logs = [math.log(value) for value in values]
                mean = math.fsum(logs) / len(logs)
                for j, value in enumerate(logs):
                    ratio_logs[j].append(value - mean)
        computed_sf = {s: math.exp(statistics.median(ratio_logs[j])) for j, s in enumerate(ids)}
        norms = [r for r in read_csv(self.out / "normalization.csv", ("analysis_id", "sample_id", "size_factor", "library_size")) if r["analysis_id"] == fit]
        indexed = unique(norms, "sample_id", fit + " normalization")
        require(set(indexed) == set(ids), fit + ": normalization sample identities mismatch")
        for sample in ids:
            close(number(indexed[sample]["size_factor"]), computed_sf[sample], fit + " size factor " + sample)
            require(integer(indexed[sample]["library_size"]) == sum(self.counts[g][self.sample_ids.index(sample)] for g in self.kept), fit + " filtered library count mismatch " + sample)
        self.sf[fit] = computed_sf
        rows = read_csv(self.out / "results" / (fit + ".csv"), ("gene_id", "symbol", "baseMean", "log2FoldChange", "lfcSE", "stat", "pvalue", "padj", "dispersion", "beta_converged"))
        tab = unique(rows, "gene_id", fit + " results")
        require(set(tab) == set(self.kept), fit + ": result gene universe mismatch")
        pvalues, tested, unconverged = [], 0, 0
        for gene, row in tab.items():
            require(row["symbol"] == self.genes[gene]["symbol"], fit + ": gene symbol mismatch " + gene)
            for field in ("baseMean", "log2FoldChange", "lfcSE", "stat", "pvalue", "padj", "dispersion"):
                row[field] = number(row[field])
            expected_mean = math.fsum(self.counts[gene][i] / computed_sf[s] for i, s in zip(indices, ids)) / len(ids)
            close(row["baseMean"], expected_mean, fit + " baseMean " + gene)
            require(row["dispersion"] is not None and row["dispersion"] > 0, fit + ": nonpositive dispersion " + gene)
            if row["stat"] is not None:
                require(row["lfcSE"] is not None and row["lfcSE"] > 0 and row["log2FoldChange"] is not None, fit + ": invalid Wald fields " + gene)
                close(row["stat"], row["log2FoldChange"] / row["lfcSE"], fit + " Wald statistic " + gene)
            if row["pvalue"] is not None:
                require(0 <= row["pvalue"] <= 1 and row["stat"] is not None, fit + ": invalid pvalue " + gene)
                close(row["pvalue"], math.erfc(abs(row["stat"]) / math.sqrt(2)), fit + " normal tail " + gene, True)
                tested += 1
            require(row["beta_converged"] in ("TRUE", "FALSE"), fit + ": invalid convergence field " + gene)
            unconverged += row["beta_converged"] == "FALSE"
            pvalues.append(row["pvalue"])
        for (gene, row), adjusted in zip(tab.items(), bh(pvalues)):
            close(row["padj"], adjusted, fit + " BH " + gene, True)
        require(unconverged == 0, f"{fit}: {unconverged} unconverged coefficient estimates")
        self.results[fit] = tab
        return dict(samples=ids, genes=len(tab), tested_pvalues=tested, NA_pvalues=len(tab)-tested,
                    significant_BH_005=sum(r["padj"] is not None and r["padj"] < .05 for r in tab.values()),
                    unconverged=unconverged, ratio_genes=len(ratio_logs[0]), size_factors=computed_sf,
                    size_factor_geometric_mean=math.exp(math.fsum(math.log(s) for s in computed_sf.values()) / len(ids)))

    def lodo(self):
        require(set(self.results) == set(FITS), "all five numerical checks are required for LODO verification")
        rows = unique(read_csv(self.out / "sensitivity.csv", ("gene_id", "symbol")), "gene_id", "sensitivity")
        require(set(rows) == set(self.kept), "sensitivity gene universe mismatch")
        for gene, row in rows.items():
            full = self.results["full"][gene]
            lod = [self.results[f][gene] for f in FITS[1:]]
            finite = [r["log2FoldChange"] for r in lod if r["log2FoldChange"] is not None]
            require(row["symbol"] == self.genes[gene]["symbol"], "sensitivity symbol mismatch " + gene)
            close(number(row["full_log2FoldChange"]), full["log2FoldChange"], "sensitivity full effect " + gene)
            close(number(row["full_padj"]), full["padj"], "sensitivity full BH " + gene, True)
            sign = lambda v: (v > 0) - (v < 0)
            expected = {"finite_lodo": len(finite), "matching_direction": sum(sign(v) == sign(full["log2FoldChange"]) for v in finite) if full["log2FoldChange"] is not None else 0,
                        "significant_lodo": sum(r["padj"] is not None and r["padj"] < .05 for r in lod)}
            for field, value in expected.items():
                require(integer(row[field]) == value, f"sensitivity {field} mismatch: {gene}")
            close(number(row["min_lodo_log2FoldChange"]), min(finite) if finite else None, "sensitivity min " + gene)
            close(number(row["max_lodo_log2FoldChange"]), max(finite) if finite else None, "sensitivity max " + gene)
        return dict(verified_sensitivity_rows=len(rows), omitted_pairs=DONORS)

    def markers(self):
        require(set(self.results) == set(FITS), "all fits required for marker observation")
        rows = read_csv(self.out / "known_genes.csv", ("analysis_id", "gene_id", "symbol", "expected_direction"))
        indexed = {(r["analysis_id"], r["gene_id"]): r for r in rows}
        require(len(rows) == len(indexed) == 30, "known gene rows must be 6 markers x 5 fits")
        observations = []
        for gene, symbol in MARKERS.items():
            full = self.results["full"][gene]
            lodo = {f: self.results[f][gene]["log2FoldChange"] for f in FITS[1:]}
            for fit in FITS:
                row = indexed[(fit, gene)]
                require(row["symbol"] == symbol and row["expected_direction"] == "positive", "marker identity/direction declaration mismatch")
                for field in ("baseMean", "log2FoldChange", "lfcSE", "stat", "pvalue", "padj", "dispersion"):
                    close(number(row[field]), self.results[fit][gene][field], f"marker export {fit} {symbol} {field}", field in ("pvalue", "padj"))
            paired = {}
            for donor in DONORS:
                untrt, trt = [next(s for s in SAMPLES if SAMPLES[s][:2] == (donor, condition)) for condition in ("untrt", "trt")]
                untreated = self.counts[gene][self.sample_ids.index(untrt)] / self.sf["full"][untrt]
                treated = self.counts[gene][self.sample_ids.index(trt)] / self.sf["full"][trt]
                paired[donor] = math.log2(treated / untreated) if untreated > 0 and treated > 0 else None
            observations.append(dict(gene_id=gene, symbol=symbol, published_direction="positive",
                                     full_log2FoldChange=full["log2FoldChange"], full_padj=full["padj"],
                                     agrees_with_published_direction=full["log2FoldChange"] is not None and full["log2FoldChange"] > 0,
                                     lodo_log2FoldChange=lodo, paired_normalized_log2_ratios=paired))
        return dict(observations=observations, direction_is_acceptance_threshold=False,
                    paper_DEG_count_is_oracle=False)

    def metadata(self):
        summary = json.loads((self.out / "summary.json").read_text())
        dataset = summary["dataset"]
        expected = dict(package="airway", geo_accession="GSE52778", publication_doi="10.1371/journal.pone.0099625", genes=63677, samples=8, prefilter_kept=16139,
                        counts_sum=sum(v[2] for v in SAMPLES.values()), donors=DONORS)
        for field, value in expected.items():
            require(dataset.get(field) == value, "dataset summary mismatch: " + field)
        method = summary["method"]
        settings = dict(design="~ cell + dex", contrast=["dex", "trt", "untrt"], test="Wald", fit_type="parametric", sf_type="ratio",
                        beta_prior=False, independent_filtering=False, cook_policy="DESeq2 default", p_adjust_method="BH", alpha=.05, seed=52778, parallel=False)
        for field, value in settings.items():
            require(method.get(field) == value, "method summary mismatch: " + field)
        version_rows = read_csv(self.out / "versions.csv", ("package", "version", "library_path"))
        versions = unique(version_rows, "package", "versions")
        require({"airway", "DESeq2", "SummarizedExperiment"} <= set(versions), "missing scientific package versions")
        require(versions["airway"]["version"] == dataset["version"], "airway version mismatch")
        require((self.out / "sessionInfo.txt").stat().st_size > 0, "empty native session record")
        require(re.fullmatch(r"[0-9a-f]{64}", summary["session"]["script_sha256"]) is not None, "missing original script digest")
        full = self.results["full"]
        facts = {"full_significant": sum(r["padj"] is not None and r["padj"] < .05 for r in full.values()),
                 "full_tested_pvalues": sum(r["pvalue"] is not None for r in full.values()),
                 "full_unconverged": sum(r["beta_converged"] == "FALSE" for r in full.values())}
        for field, expected_value in facts.items():
            require(summary["facts"][field] == expected_value, "summary fact mismatch: " + field)
        return dict(R=summary["session"]["R"], package_versions={p: versions[p]["version"] for p in ("airway", "DESeq2", "SummarizedExperiment")},
                    script_sha256=summary["session"]["script_sha256"], recomputed_facts=facts)

    def bootstrap(self):
        directory = self.out / "bootstrap"
        plan = json.loads((directory / "plan.json").read_text())
        repetitions = plan["replicates"]
        require(type(repetitions) is int and 1 <= repetitions <= 1000, "bootstrap replicates must be in the declared 1..1000 execution bound")
        require(plan["schema_version"] == 1 and plan["seed"] == 52778, "bootstrap plan version/seed mismatch")
        require(plan["rng_kind"] == ["Mersenne-Twister", "Inversion", "Rejection"], "bootstrap RNG declaration mismatch")
        require(plan["samples"] == self.sample_ids and plan["fitted_genes"] == plan["genes_per_replicate"] == len(self.kept), "bootstrap input universe mismatch")
        require(set(plan["markers"]) == set(MARKERS.values()) and len(plan["markers"]) == 6, "bootstrap marker set mismatch")
        require(plan["generator"] == "stats::rnbinom" and plan["parameterization"] == "mu=full fitted mean, size=1/full fitted dispersion", "bootstrap generator declaration mismatch")
        require(plan["variance"] == "mu + dispersion * mu^2", "bootstrap variance declaration mismatch")
        require(plan["design"] == "~ cell + dex" and plan["contrast"] == ["dex", "trt", "untrt"], "bootstrap paired contrast mismatch")
        require(plan["estimator"] == "refit DESeq2 Wald/parametric/ratio/betaPrior=FALSE", "bootstrap estimator declaration mismatch")
        require(plan["independent_filtering"] is False and plan["p_adjust_method"] == "BH" and plan["cook_policy"] == "DESeq2 default", "bootstrap multiple testing declaration mismatch")
        require(plan["quantile_type"] == 7 and plan["quantile_probabilities"] == [.025, .5, .975], "bootstrap quantile declaration mismatch")
        require("Conditional" in plan["scope"] and "not a population or clinical" in plan["scope"], "bootstrap scope must state fitted-model limitation")
        overall = json.loads((self.out / "summary.json").read_text())["method"]["bootstrap"]
        require(overall["replicates"] == repetitions and overall["seed"] == plan["seed"] and overall["scope"] == plan["scope"], "bootstrap summary/plan mismatch")
        means = unique(read_csv(directory / "means.csv", ["gene_id"] + self.sample_ids), "gene_id", "bootstrap means")
        dispersions = unique(read_csv(directory / "dispersion.csv", ("gene_id", "dispersion")), "gene_id", "bootstrap dispersions")
        require(list(means) == self.kept and list(dispersions) == self.kept, "bootstrap fitted parameter gene order mismatch")
        for gene in self.kept:
            means[gene] = [number(means[gene][s]) for s in self.sample_ids]
            require(all(m is not None and m > 0 for m in means[gene]), "nonpositive fitted mean: " + gene)
            dispersions[gene] = number(dispersions[gene]["dispersion"])
            close(dispersions[gene], self.results["full"][gene]["dispersion"], "bootstrap source dispersion " + gene)
            for donor in DONORS:
                untreated, treated = [next(s for s in SAMPLES if SAMPLES[s][:2] == (donor, condition)) for condition in ("untrt", "trt")]
                ratio = (means[gene][self.sample_ids.index(treated)] / self.sf["full"][treated]) / (means[gene][self.sample_ids.index(untreated)] / self.sf["full"][untreated])
                close(math.log2(ratio), self.results["full"][gene]["log2FoldChange"], "bootstrap fitted-mean contrast " + gene)
        replica_rows = read_csv(directory / "replicates.csv", ("replicate", "n_genes", "n_samples", "simulated_counts_sum", "simulated_counts_sha256", "tested_pvalues", "missing_pvalues", "significant_genes", "unconverged_genes", "elapsed_seconds"))
        replicas = unique(replica_rows, "replicate", "bootstrap repetitions")
        require(set(replicas) == {str(i) for i in range(1, repetitions+1)}, "bootstrap replicate identities/gaps mismatch")
        hashes = set()
        for rep, row in replicas.items():
            for field in ("n_genes", "n_samples", "simulated_counts_sum", "tested_pvalues", "missing_pvalues", "significant_genes", "unconverged_genes"):
                row[field] = integer(row[field])
            require(row["n_genes"] == len(self.kept) and row["n_samples"] == 8, "bootstrap simulated universe mismatch: " + rep)
            require(row["tested_pvalues"] + row["missing_pvalues"] == len(self.kept), "bootstrap test counter mismatch: " + rep)
            require(row["significant_genes"] <= row["tested_pvalues"] and row["unconverged_genes"] <= len(self.kept), "bootstrap counter bounds mismatch: " + rep)
            require(number(row["elapsed_seconds"]) > 0 and row["simulated_counts_sum"] > 0, "bootstrap nonpositive runtime/count sum: " + rep)
            require(re.fullmatch(r"[0-9a-f]{64}", row["simulated_counts_sha256"]) is not None, "bootstrap invalid simulated digest: " + rep)
            hashes.add(row["simulated_counts_sha256"])
        require(len(hashes) == repetitions, "bootstrap reports duplicated simulated matrices")
        first_rows = read_csv(directory / "first-simulated-counts.csv", ["gene_id"] + self.sample_ids)
        first = unique(first_rows, "gene_id", "bootstrap first matrix")
        require(list(first) == self.kept, "bootstrap first simulated gene order mismatch")
        for gene in self.kept:
            first[gene] = [integer(first[gene][s]) for s in self.sample_ids]
        first_total = sum(sum(values) for values in first.values())
        first_text = ",".join(str(first[gene][j]) for j in range(8) for gene in self.kept)
        first_hash = hashlib.sha256(first_text.encode("ascii")).hexdigest()
        require(first_total == replicas["1"]["simulated_counts_sum"] and first_hash == replicas["1"]["simulated_counts_sha256"], "bootstrap first simulated matrix total/digest mismatch")
        first_logs = [[] for _ in self.sample_ids]
        for values in first.values():
            if all(values):
                logs = [math.log(v) for v in values]
                gm = math.fsum(logs) / 8
                for j, value in enumerate(logs):
                    first_logs[j].append(value - gm)
        first_sf = [math.exp(statistics.median(values)) for values in first_logs]
        marker_rows = read_csv(directory / "markers.csv", ("replicate", "gene_id", "symbol", "baseMean", "log2FoldChange", "lfcSE", "stat", "pvalue", "padj", "beta_converged"))
        marker_counts = read_csv(directory / "marker-counts.csv", ["replicate", "gene_id", "symbol"] + self.sample_ids)
        markers = {(r["replicate"], r["gene_id"]): r for r in marker_rows}
        counts = {(r["replicate"], r["gene_id"]): r for r in marker_counts}
        identities = {(str(rep), gene) for rep in range(1, repetitions+1) for gene in MARKERS}
        require(len(markers) == len(marker_rows) == len(counts) == len(marker_counts) == repetitions*6 and set(markers) == set(counts) == identities, "bootstrap marker repetition/gene identities mismatch")
        samples_observed = {gene: [[] for _ in self.sample_ids] for gene in MARKERS}
        for (rep, gene), row in markers.items():
            require(row["symbol"] == counts[(rep, gene)]["symbol"] == MARKERS[gene], "bootstrap marker annotation mismatch")
            for field in ("baseMean", "log2FoldChange", "lfcSE", "stat", "pvalue", "padj"):
                row[field] = number(row[field])
            require(row["beta_converged"] in ("TRUE", "FALSE"), "bootstrap marker convergence field mismatch")
            if row["stat"] is not None:
                require(row["lfcSE"] is not None and row["lfcSE"] > 0 and row["log2FoldChange"] is not None, "bootstrap marker invalid Wald fields")
                close(row["stat"], row["log2FoldChange"]/row["lfcSE"], f"bootstrap Wald {rep} {gene}")
            if row["pvalue"] is not None:
                require(0 <= row["pvalue"] <= 1 and row["stat"] is not None and row["padj"] is not None, "bootstrap marker invalid pvalue")
                close(row["pvalue"], math.erfc(abs(row["stat"])/math.sqrt(2)), f"bootstrap normal tail {rep} {gene}", True)
                require(0 <= row["padj"] <= 1 and row["padj"] >= row["pvalue"]*(1-1e-9), "bootstrap marker BH outside mathematical bounds")
            else:
                require(row["padj"] is None, "bootstrap marker NA pvalue/adjustment mismatch")
            values = [integer(counts[(rep, gene)][s]) for s in self.sample_ids]
            require(sum(values) <= replicas[rep]["simulated_counts_sum"], "bootstrap marker counts exceed whole matrix count sum")
            if rep == "1":
                require(values == first[gene], "bootstrap first marker count mismatch")
                close(row["baseMean"], math.fsum(c/s for c, s in zip(values, first_sf))/8, "bootstrap first marker baseMean " + gene)
            for j, value in enumerate(values):
                samples_observed[gene][j].append(value)
        for rep in replicas:
            z = [markers[(rep, g)] for g in MARKERS]
            require(sum(r["pvalue"] is None for r in z) <= replicas[rep]["missing_pvalues"], "bootstrap marker missing counter exceeds global missing counter")
            require(sum(r["beta_converged"] == "FALSE" for r in z) <= replicas[rep]["unconverged_genes"], "bootstrap marker nonconvergence exceeds global counter")
            require(sum(r["padj"] is not None and r["padj"] < .05 for r in z) <= replicas[rep]["significant_genes"], "bootstrap marker significance exceeds global counter")
        summary = unique(read_csv(directory / "summary.csv", ("gene_id", "symbol", "q025", "q50", "q975")), "gene_id", "bootstrap summary")
        require(set(summary) == set(MARKERS), "bootstrap summary marker identities mismatch")
        summaries, moments = [], []
        for gene, symbol in MARKERS.items():
            row = summary[gene]
            require(row["symbol"] == symbol and integer(row["requested_replicates"]) == repetitions and integer(row["quantile_type"]) == 7, "bootstrap summary identity/quantile mismatch")
            z = [markers[(str(rep), gene)] for rep in range(1, repetitions+1)]
            valid = [r["log2FoldChange"] for r in z if r["log2FoldChange"] is not None and r["beta_converged"] == "TRUE"]
            expected = dict(finite_converged=len(valid), excluded_lfc_or_convergence=repetitions-len(valid), missing_pvalues=sum(r["pvalue"] is None for r in z),
                            positive_count=sum(v > 0 for v in valid), negative_count=sum(v < 0 for v in valid), zero_count=sum(v == 0 for v in valid))
            for field, value in expected.items():
                require(integer(row[field]) == value, f"bootstrap summary {field} mismatch {symbol}")
            close(number(row["full_log2FoldChange"]), self.results["full"][gene]["log2FoldChange"], "bootstrap full effect " + symbol)
            positive_fraction = expected["positive_count"]/len(valid) if valid else None
            close(number(row["positive_fraction"]), positive_fraction, "bootstrap sign fraction " + symbol)
            quantiles = {field: quantile7(valid, p) for field, p in zip(("q025", "q50", "q975"), (.025, .5, .975))}
            for field, value in quantiles.items():
                close(number(row[field]), value, "bootstrap " + field + " " + symbol)
            summaries.append(dict(gene_id=gene, symbol=symbol, requested_replicates=repetitions, positive_fraction=positive_fraction, **expected, **quantiles))
            for j, sample in enumerate(self.sample_ids):
                mu, disp = means[gene][j], dispersions[gene]
                model_variance = mu + disp*mu*mu
                observed_mean = statistics.mean(samples_observed[gene][j])
                observed_variance = statistics.variance(samples_observed[gene][j]) if repetitions > 1 else None
                moments.append(dict(gene_id=gene, symbol=symbol, sample_id=sample, fitted_mean=mu, model_variance=model_variance,
                                    empirical_mean=observed_mean, empirical_variance=observed_variance,
                                    mean_deviation_in_model_SE=(observed_mean-mu)/math.sqrt(model_variance/repetitions),
                                    variance_ratio=observed_variance/model_variance if observed_variance is not None else None))
        require((directory / "marker-distributions.pdf").read_bytes().startswith(b"%PDF-"), "bootstrap distributions are not a PDF")
        return dict(replicates=repetitions, fitted_parameter_genes=len(means), fitted_mean_contrasts_verified=4*len(means),
                    first_simulated_counts_sum=first_total, first_simulated_counts_sha256=first_hash,
                    first_simulated_size_factors=dict(zip(self.sample_ids, first_sf)), marker_rows=len(markers),
                    marker_Wald_normal_tails_checked=sum(r["pvalue"] is not None for r in markers.values()),
                    bootstrap_whole_BH_independently_recomputed=False, first_full_matrix_digest_checked=True,
                    remaining_full_matrix_digests_independently_recomputed=False,
                    conditional_sampling_summaries=summaries, NB_marker_moment_observations=moments,
                    moment_or_positive_fraction_threshold_used=False)

    def run(self):
        self.check("artifact_integrity", self.integrity, "Self-declared SHA256 and a completion marker detect changed or missing artifacts; they do not prove historical operation provenance. Core receipts must establish that separately. PDF signature is not a visual inspection.")
        self.check("public_input_and_pairing", self.inputs, "Checks package input identities, counts, annotation and filtering; it does not rerun FASTQ alignment or independently authenticate every input count.")
        self.check("analysis_plan", self.plans, "Balanced donor-paired design has full rank; plan declarations alone cannot prove which native model was executed.")
        for fit in FITS:
            self.check("numerical_" + fit, lambda f=fit: self.numerical(f), "Independently rederives ratio factors, baseMean, Wald normal tails and BH. It does not independently refit DESeq2 dispersions or coefficients. Cook-filtered NA pvalues remain NA. Size-factor geometric mean need not equal 1.")
        self.check("lodo_exports", self.lodo, "Leaving out the same original donor pairs describes sensitivity; these correlated fits are not independent biological replication.")
        self.check("published_marker_observations", self.markers, "Numerical exports are checked; agreement with published directions is recorded as an observation, not a forced pass. Same-dataset agreement is not a novel discovery or a clinical efficacy claim.")
        self.check("session_and_summary", self.metadata, "Recorded versions and recomputed counters do not authenticate the runtime or script digest against Core receipts; root checks that separately.")
        if (self.out / "bootstrap").exists() or "bootstrap" in self.summary.get("method", {}):
            self.check("bootstrap_conditional_artifacts", self.bootstrap, "Independently verifies fitted-mean contrasts, source dispersions, first full simulated matrix digest and marker counts, marker Wald tails and type-7 summaries. Whole bootstrap BH cannot be independently recomputed from six-marker exports; only the first whole simulated matrix is exported. NB sample moments are descriptive observations, not distributional pass thresholds. No independent R RNG replay, dispersion/coefficient refitting or biological replication is claimed.")
        return dict(schema_version=1, checker="stdlib-independent-airway-verifier", output_directory=str(self.out),
                    verified_at=datetime.now(timezone.utc).isoformat(), passed=all(c["status"] == "pass" for c in self.checks),
                    numeric_tolerances=dict(general_relative=1e-9, general_absolute=1e-10,
                                            probability_relative=1e-7, probability_absolute=5e-324),
                    checks=self.checks, sources=SOURCES,
                    scope="Public-data domain artifact and arithmetic checks. Execution continuity, native dispatch count, upstream quantification, visual readability, and scientific generalization require their own evidence.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_directory", type=Path)
    parser.add_argument("--report", required=True, type=Path, help="Write report outside the immutable artifact directory")
    args = parser.parse_args()
    out, report = args.output_directory.resolve(), args.report.resolve()
    if report.is_relative_to(out):
        parser.error("--report must be outside the artifact directory; verification does not alter products")
    result = Verifier(out).run()
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    failed = [c for c in result["checks"] if c["status"] == "fail"]
    print(json.dumps(dict(passed=result["passed"], checks=len(result["checks"]), failures=[dict(check=c["check"], error=c["error"]) for c in failed], report=str(report)), ensure_ascii=False))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
