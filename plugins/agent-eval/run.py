#!/usr/bin/env python3
"""Reusable evaluation entry: core-agent, r-artifacts, or an owner checker case."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def stop_owned_group(proc):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(proc.pid, sig)
        except ProcessLookupError:
            pass
        try:
            proc.wait(timeout=1)
        except subprocess.TimeoutExpired:
            continue
        # The leader can exit before descendants; the second signal still
        # targets this checker group, never a user runtime.
        if sig == signal.SIGTERM:
            continue


def run_checker(command, destination, timeout, max_output):
    """Retain bounded raw output and failure facts, without importing an Owner."""
    write_json(destination / "command.json", command)
    started = time.monotonic()
    proc = None
    error = None
    retained = 0
    try:
        with selectors.DefaultSelector() as selector, \
                (destination / "stdout.txt").open("wb") as stdout, \
                (destination / "stderr.txt").open("wb") as stderr:
            proc = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    start_new_session=True)
            for stream, target in ((proc.stdout, stdout), (proc.stderr, stderr)):
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, selectors.EVENT_READ, target)
            while selector.get_map() or proc.poll() is None:
                if time.monotonic() - started >= timeout:
                    raise TimeoutError("checker time budget exhausted")
                for key, _ in selector.select(min(.1, max(0, timeout - (time.monotonic() - started)))):
                    block = os.read(key.fileobj.fileno(), 65536)
                    if not block:
                        selector.unregister(key.fileobj)
                        continue
                    allowed = max_output - retained
                    key.data.write(block[:allowed])
                    retained += min(len(block), allowed)
                    if len(block) > allowed:
                        raise ValueError("checker stdout/stderr retention budget exhausted")
    except BaseException as caught:
        error = type(caught).__name__ + ": " + str(caught)
        if not isinstance(caught, Exception):
            raise
    finally:
        if proc is not None:
            stop_owned_group(proc)
            proc.stdout.close()
            proc.stderr.close()
        write_json(destination / "execution.json", {
            "exit_code": proc.returncode if proc else None, "runtime_error": error,
            "elapsed_seconds": time.monotonic() - started, "retained_output_bytes": retained,
        })
    return proc.returncode if proc else None, error


def evaluate(case, destination, trials=1, timeout=180, max_output=8 * 1024 * 1024):
    if not isinstance(case.get("id"), str) or not isinstance(case.get("scope"), str):
        raise ValueError("case requires an id and an explicit scope")
    command = case.get("command")
    if not isinstance(command, list) or not command or not all(isinstance(arg, str) for arg in command):
        raise ValueError("command must be a nonempty argv array")
    if sum(arg == "{report}" for arg in command) != 1:
        raise ValueError("command must contain exactly one {report} argument")
    destination.mkdir(parents=True, exist_ok=False)
    sources = {}
    for arg in command:
        try:
            path = Path(arg)
            if path.is_file():
                sources[str(path.resolve())] = digest(path)
        except OSError:
            # Inline program arguments are not necessarily filesystem paths.
            continue
    identity_files = [Path(p) for p in case.get("identity_files", [])]
    before = {str(p): digest(p) for p in identity_files if p.is_file()}
    write_json(destination / "manifest.json", {
        "started_at": datetime.now(timezone.utc).isoformat(), "mode": "owner_check",
        "case": case, "source_sha256": sources, "entry_sha256": digest(Path(__file__)),
        "input_identity_sha256": before, "trials": trials, "timeout_seconds": timeout,
        "max_output_bytes": max_output, "working_directory": str(Path.cwd()),
    })
    results = []
    try:
        for trial in range(1, trials + 1):
            output = destination / f"trial-{trial}"
            output.mkdir()
            report = output / "owner-report.json"
            argv = [str(report) if arg == "{report}" else arg for arg in command]
            try:
                code, error = run_checker(argv, output, timeout, max_output)
                owner = json.loads(report.read_text()) if report.is_file() and report.stat().st_size <= max_output else {}
                unchanged = all(p.is_file() and str(p) in before and digest(p) == before[str(p)] for p in identity_files)
                result = {"trial": trial, "passed": code == 0 and error is None and owner.get("passed") is True and unchanged,
                          "exit_code": code, "runtime_error": error, "owner_passed": owner.get("passed"),
                          "input_identity_unchanged": unchanged,
                          "checks": owner.get("checks", []), "scope": case["scope"],
                          "not_scored": case.get("not_scored", [])}
            except BaseException as caught:
                result = {"trial": trial, "passed": False, "runtime_error": type(caught).__name__ + ": " + str(caught),
                          "scope": case["scope"], "not_scored": case.get("not_scored", [])}
                write_json(output / "report.json", result)
                results.append(result)
                if not isinstance(caught, Exception):
                    raise
            else:
                write_json(output / "report.json", result)
                results.append(result)
            print(f"{'PASS' if result['passed'] else 'FAIL'} {case['id']} {trial}", flush=True)
    finally:
        write_json(destination / "summary.json", {
            "passed": sum(item["passed"] for item in results), "total": trials,
            "completed_trials": len(results), "not_run_trials": trials - len(results), "results": results,
        })
    print(f"Evidence: {destination}", flush=True)
    return len(results) == trials and all(item["passed"] for item in results)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "core-agent":
        os.execv(sys.executable, [sys.executable, str(HERE / "core-agent/run.py"), *argv[1:]])
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="consumer", required=True)
    sub.add_parser("core-agent", help="migrated Claude Code evaluation; use core-agent --help")
    check = sub.add_parser("check", help="run an owner checker described by an ordinary JSON case file")
    check.add_argument("--case", type=Path, required=True)
    artifacts = sub.add_parser("r-artifacts", help="check existing airway artifacts without rerunning R or calling a model")
    artifacts.add_argument("artifacts", type=Path)
    for selected in (check, artifacts):
        selected.add_argument("--output", type=Path, help="new evidence directory")
        selected.add_argument("--trials", type=int, default=1)
        selected.add_argument("--timeout", type=float, default=180)
        selected.add_argument("--max-output-bytes", type=int, default=8 * 1024 * 1024)
    args = parser.parse_args(argv)
    if not 1 <= args.trials <= 20 or not .01 <= args.timeout <= 600 or not 1024 <= args.max_output_bytes <= 64 * 1024 * 1024:
        parser.error("trials: 1..20; timeout: .01..600 seconds; max output: 1 KiB..64 MiB")
    if args.consumer == "check":
        case = json.loads(args.case.read_text())
    else:
        root = args.artifacts.resolve()
        case = {"id": "airway-artifacts", "command": [sys.executable,
                str(REPO / "examples/real-r-analysis/verify.py"), str(root), "--report", "{report}"],
                "identity_files": [str(root / "complete.json"), str(root / "artifact_manifest.csv")],
                "scope": "Existing airway artifact integrity and independent arithmetic; the R Owner defines checks and limits.",
                "not_scored": ["Agent autonomy", "DESeq2 refitting", "native RDS observation", "scientific generalization", "execution continuity"]}
    destination = args.output.resolve() if args.output else REPO / "target/agent-evals" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    if args.consumer == "r-artifacts" and destination.is_relative_to(args.artifacts.resolve()):
        parser.error("evidence must be outside the artifact directory")
    if destination.exists():
        parser.error("evidence directory must be new")
    return 0 if evaluate(case, destination, args.trials, args.timeout, args.max_output_bytes) else 1


if __name__ == "__main__":
    sys.exit(main())
