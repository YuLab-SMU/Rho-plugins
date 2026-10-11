#!/usr/bin/env python3
"""Verify rejection of altered BH values and incomplete artifact copies."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_csv(path, fields, rows):
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fields)
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifacts", type=Path)
    parser.add_argument("--root", required=True, type=Path, help="New directory outside original artifacts")
    args = parser.parse_args()
    source, root = args.artifacts.resolve(strict=True), args.root.resolve()
    if root.is_relative_to(source):
        parser.error("--root must be outside original artifacts")
    root.mkdir(parents=True, exist_ok=False)
    original_marker = sha(source / "complete.json")
    original_table = sha(source / "results/full.csv")
    results = []
    for case in ("altered-bytes", "rehash-wrong-BH", "missing-complete"):
        altered = root / case
        shutil.copytree(source, altered)
        if case == "missing-complete":
            (altered / "complete.json").unlink()
        else:
            table = altered / "results/full.csv"
            with table.open(newline="") as stream:
                reader = csv.DictReader(stream)
                fields, rows = reader.fieldnames, list(reader)
            # Alter one available adjusted probability; preserve its p-value.
            row = next(row for row in rows if row["padj"])
            row["padj"] = "0.5" if float(row["padj"]) != .5 else "0.25"
            write_csv(table, fields, rows)
            if case == "rehash-wrong-BH":
                manifest_path = altered / "artifact_manifest.csv"
                with manifest_path.open(newline="") as stream:
                    reader = csv.DictReader(stream)
                    fields, manifest = reader.fieldnames, list(reader)
                entry = next(entry for entry in manifest if entry["path"] == "results/full.csv")
                entry.update(bytes=str(table.stat().st_size), sha256=sha(table))
                write_csv(manifest_path, fields, manifest)
                marker_path = altered / "complete.json"
                marker = json.loads(marker_path.read_text())
                marker["manifest_sha256"] = sha(manifest_path)
                marker_path.write_text(json.dumps(marker, indent=2) + "\n")
        report = root / (case + "-report.json")
        checked = subprocess.run([sys.executable, str(HERE / "verify.py"), str(altered),
                                  "--report", str(report)], capture_output=True, text=True, timeout=120)
        (root / (case + "-call.json")).write_text(json.dumps(dict(
            exit_code=checked.returncode, stdout=checked.stdout, stderr=checked.stderr), indent=2) + "\n")
        facts = json.loads(report.read_text())
        checks = {check["check"]: check for check in facts["checks"]}
        if checked.returncode != 1 or facts["passed"]:
            raise AssertionError(case + " was not rejected")
        if case == "rehash-wrong-BH":
            if checks["artifact_integrity"]["status"] != "pass" or " BH " not in checks["numerical_full"].get("error", ""):
                raise AssertionError("Rehashed false probability was not rejected by the independent BH calculation")
        elif checks["artifact_integrity"]["status"] != "fail":
            raise AssertionError(case + " did not fail artifact integrity")
        results.append(dict(case=case, exit_code=checked.returncode, rejected=True,
                            failures=[check for check in facts["checks"] if check["status"] == "fail"]))
        # Keep the failed reports, not three additional large model copies.
        shutil.rmtree(altered)
    if sha(source / "complete.json") != original_marker or sha(source / "results/full.csv") != original_table:
        raise AssertionError("Original artifacts changed")
    (root / "report.json").write_text(json.dumps(dict(status="passed", cases=results,
        original_unchanged=True), ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(dict(status="passed", negative_cases=len(results), reports=str(root))))


if __name__ == "__main__":
    main()
