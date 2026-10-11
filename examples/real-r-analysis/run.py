#!/usr/bin/env python3
"""A real R consumer using only the public rho-core CLI, with retained evidence."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import select
import shutil
import signal
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
CALLER = "airway-domain"
REQUEST = "dex-paired-bootstrap-001"


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def require(condition, description):
    if not condition:
        raise AssertionError(description)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Host:
    def __init__(self, binary, rscript, project, state, evidence):
        self.binary, self.evidence = binary, evidence
        self.socket = state / "host.sock"
        require(len(os.fsencode(self.socket)) < 100, "Choose a shorter disposable root for the Unix socket")
        self.calls = []
        env = os.environ.copy()
        env.pop("RHO_CORE_CRASH_AT", None)
        env.pop("RHO_CORE_FAIL_AT", None)
        for key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
            env[key] = "1"
        command = [str(binary), "serve", "--project", str(project), "--state-dir", str(state),
                   "--executor", "r=" + str(rscript), "--executor-arg", "r=--vanilla",
                   "--limit", "max_running=1", "--limit", "max_records=4"]
        self.stderr = (evidence / "host.stderr.txt").open("w")
        self.proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=self.stderr,
                                     text=True, env=env, start_new_session=True)
        try:
            require(select.select([self.proc.stdout], [], [], 10)[0], "Host readiness timed out")
            line = self.proc.stdout.readline()
            (evidence / "host-ready.txt").write_text(line)
            require(bool(line), "Host exited before readiness; inspect host.stderr.txt")
            ready = json.loads(line)
            require(ready["ready"]["socket"] == str(self.socket), "Unexpected Host socket")
            save(evidence / "host-ready.json", ready)
        except BaseException:
            self.close()
            raise

    def command(self, arguments):
        flags = ["--socket", str(self.socket), "--caller", CALLER]
        if "--" in arguments:
            split = arguments.index("--")
            return [str(self.binary), *arguments[:split], *flags, *arguments[split:]]
        return [str(self.binary), *arguments, *flags]

    def call(self, arguments):
        started = time.time_ns()
        try:
            proc = subprocess.run(self.command(arguments), capture_output=True, text=True, timeout=45)
        except subprocess.TimeoutExpired as error:
            self.calls.append({"arguments": arguments, "started_at_ns": started,
                               "ended_at_ns": time.time_ns(), "timeout": True,
                               "stdout": (error.stdout or b"").decode() if isinstance(error.stdout, bytes) else error.stdout,
                               "stderr": (error.stderr or b"").decode() if isinstance(error.stderr, bytes) else error.stderr,
                               "delivery": "unknown; inspect the original request without replay"})
            save(self.evidence / "cli-calls.json", self.calls)
            raise
        raw = {"arguments": arguments, "started_at_ns": started, "ended_at_ns": time.time_ns(),
               "exit_code": proc.returncode, "stdout": proc.stdout, "stderr": proc.stderr}
        self.calls.append(raw)
        save(self.evidence / "cli-calls.json", self.calls)
        value = json.loads(proc.stdout)
        require(proc.returncode == 0 and value["ok"], "CLI failed; inspect cli-calls.json")
        return value["value"]

    def close(self):
        result = {"host_pid": self.proc.pid, "forced": False}
        if self.proc.poll() is None:
            self.proc.send_signal(signal.SIGTERM)
            try:
                stdout, _ = self.proc.communicate(timeout=15)
                result["stdout"] = stdout
                if stdout:
                    result["shutdown"] = json.loads(stdout)["shutdown"]
            except subprocess.TimeoutExpired:
                self.proc.kill()
                stdout, _ = self.proc.communicate(timeout=5)
                result.update(forced=True, stdout=stdout)
        result["exit_code"] = self.proc.returncode
        result["socket_removed"] = not self.socket.exists()
        self.stderr.close()
        save(self.evidence / "cleanup.json", result)
        return result


def entries(output):
    path = Path(str(output) + ".entries.jsonl")
    return [json.loads(line) for line in path.read_text().splitlines()]


def read_all(host, stream):
    offset, text, reads = 0, [], []
    while True:
        value = host.call(["read", "--id", REQUEST, "--stream", stream,
                           "--offset", str(offset), "--max-bytes", "4096"])
        require(not value["lossy"], "Lossy R output")
        text.append(value["text"])
        reads.append(value)
        offset = value["next_offset"]
        if not value["more_retained"]:
            break
    (host.evidence / ("r." + stream + ".txt")).write_text("".join(text))
    save(host.evidence / (stream + "-reads.json"), reads)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--root", required=True, type=Path, help="New disposable root; preserved as evidence")
    parser.add_argument("--rscript", default="/usr/local/bin/Rscript", type=Path)
    parser.add_argument("--timeout", default=1800, type=int,
                        help="Overall managed computation seconds; cancel on exhaustion (30 to 7200)")
    args = parser.parse_args()
    require(30 <= args.timeout <= 7200, "Timeout outside 30..7200 seconds")
    binary, rscript = args.binary.resolve(strict=True), args.rscript.resolve(strict=True)
    require((HERE / "verify.py").is_file(), "Independent verifier must exist before starting the analysis")
    require((HERE / "inspect-models.R").is_file(), "Native model observer must exist before starting the analysis")
    root = args.root.resolve()
    root.mkdir(parents=True, exist_ok=False)
    project, evidence = root / "project", root / "evidence"
    project.mkdir()
    evidence.mkdir()
    script = project / "analysis.R"
    shutil.copyfile(HERE / "analyze.R", script)
    output = project / "artifacts"
    meta = {"started_at_ns": time.time_ns(), "core_binary": str(binary), "core_sha256": sha(binary),
            "rscript": str(rscript), "analysis_sha256": sha(script), "caller": CALLER,
            "request_id": REQUEST, "timeout_seconds": args.timeout,
            "consumer": "Rho-plugins real R analysis; external Codex Agent via public CLI"}
    save(evidence / "environment.json", meta)
    host, failure, report = None, None, None
    try:
        # The dataset is read from the real installed Owner, without starting Core.
        native_code = ('suppressPackageStartupMessages(library(airway)); data(airway); '
                       'suppressPackageStartupMessages(library(SummarizedExperiment)); '
                       'x <- assay(airway); '
                       'utils::write.csv(data.frame(gene_id=rownames(x), x, check.names=FALSE), '
                       'commandArgs(TRUE)[2], row.names=FALSE, na=""); '
                       'jsonlite::write_json(list(dim=dim(x), total=sum(x), '
                       'sample_ids=colnames(x), library_sizes=colSums(x), '
                       'counts_sha256=digest::digest(file=commandArgs(TRUE)[2], algo="sha256"), '
                       'airway=as.character(packageVersion("airway")), '
                       'R=R.version.string), commandArgs(TRUE)[1], auto_unbox=TRUE, pretty=TRUE)')
        baseline = subprocess.run([str(rscript), "--vanilla", "-e", native_code,
                                   str(evidence / "native-input.json"), str(evidence / "native-counts.csv")],
                                  capture_output=True, text=True, timeout=90)
        save(evidence / "native-input-call.json", {"exit_code": baseline.returncode,
             "stdout": baseline.stdout, "stderr": baseline.stderr})
        require(baseline.returncode == 0, "Native R input observation failed")
        host = Host(binary, rscript, project, root / "state", evidence)
        capability = host.call(["capability"])
        save(evidence / "capability.json", capability)
        arguments = ["submit", "--id", REQUEST, "--executor", "r", "--code-file", str(script), "--", str(output)]
        accepted = host.call(arguments)
        require(accepted["disposition"] == "accepted", "Expected first acceptance")
        run_id = accepted["run"]["run_id"]
        deadline = time.monotonic() + args.timeout
        while not Path(str(output) + ".entries.jsonl").exists():
            require(time.monotonic() < deadline, "R never entered")
            view = host.call(["wait", "--id", REQUEST, "--timeout", "1"])
            require(not view["terminal"], "R ended before entry observation")
        waiter = subprocess.Popen(host.command(["wait", "--id", REQUEST, "--timeout", "30"]),
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            time.sleep(0.2)  # Allow this independent client to enter its blocking wait.
            require(waiter.poll() is None, "Analysis ended before interruption")
            waiter.send_signal(signal.SIGTERM)
            stdout, stderr = waiter.communicate(timeout=5)
            save(evidence / "interrupted-wait.json", {"exit_code": waiter.returncode,
                 "stdout": stdout, "stderr": stderr, "request_id": REQUEST, "run_id": run_id})
        finally:
            if waiter.poll() is None:
                waiter.kill()
                waiter.communicate(timeout=5)
        found = host.call(["lookup", "--id", REQUEST, "--record"])
        require(found["run_id"] == run_id and found["held"] and not found["terminal"],
                "Wait interruption failed to preserve the same live R run")
        require(found["record"]["script"]["sha256"] == meta["analysis_sha256"], "Accepted code snapshot differs")
        duplicate = host.call(arguments)
        require(duplicate["disposition"] == "existing" and duplicate["run"]["run_id"] == run_id,
                "Retry did not return the original run")
        print(json.dumps({"stage": "wait-interrupted-and-reconnected", "run_id": run_id}), flush=True)
        while True:
            if time.monotonic() >= deadline:
                host.call(["cancel", "--id", REQUEST])
                host.call(["wait", "--id", REQUEST, "--timeout", "20"])
                raise TimeoutError("Managed scientific computation exceeded configured budget; partial evidence retained")
            final = host.call(["wait", "--id", REQUEST, "--timeout", "30"])
            if final["terminal"]:
                break
            print(json.dumps({"stage": "same-R-run-still-running", "run_id": run_id,
                              "elapsed_seconds": (time.time_ns() - meta["started_at_ns"]) / 1e9}), flush=True)
        require(final["run_id"] == run_id and not final["held"] and not final["unsaved"], "Incomplete final facts")
        require(final["status"]["Finished"]["exit"] == {"Code": 0}, "R analysis failed")
        for stream in ("stdout", "stderr"):
            info = final[stream]
            require(info["eof"] and info["retention_error"] is None and
                    info["retained_bytes"] == info["observed_bytes"], "Incomplete retained " + stream)
            read_all(host, stream)
        require(len(entries(output)) == 1, "R entered more than once")
        require((output / "complete.json").exists(), "No complete scientific artifact set")
        native = json.loads((evidence / "native-input.json").read_text())
        summary = json.loads((output / "summary.json").read_text())
        require(sha(output / "input/counts.csv") == native["counts_sha256"], "Scientific input differs from native public data")
        require(summary["session"]["script_sha256"] == meta["analysis_sha256"] and
                summary["session"]["pid"] == accepted["run"]["status"]["Running"]["pid"],
                "Artifact-producing R session differs from accepted execution")
        observed = subprocess.run([str(rscript), "--vanilla", str(HERE / "inspect-models.R"),
                                   str(output), str(evidence / "native-model-observation.json")],
                                  capture_output=True, text=True, timeout=120)
        save(evidence / "native-model-call.json", {"exit_code": observed.returncode,
             "stdout": observed.stdout, "stderr": observed.stderr})
        require(observed.returncode == 0, "Saved native model observation failed")
        verified = subprocess.run([sys.executable, str(HERE / "verify.py"), str(output),
                                   "--report", str(evidence / "science-verification.json")],
                                  capture_output=True, text=True, timeout=120)
        save(evidence / "verification-call.json", {"exit_code": verified.returncode,
             "stdout": verified.stdout, "stderr": verified.stderr})
        require(verified.returncode == 0, "Independent scientific checks failed")
        # These are ordinary native artifacts; Core does not claim to retain their bytes.
        retrieved = root / "retrieved"
        shutil.copytree(output, retrieved)
        retrieved_check = subprocess.run([sys.executable, str(HERE / "verify.py"), str(retrieved),
                                         "--report", str(evidence / "retrieval-verification.json")],
                                        capture_output=True, text=True, timeout=120)
        save(evidence / "retrieval-call.json", {"exit_code": retrieved_check.returncode,
             "stdout": retrieved_check.stdout, "stderr": retrieved_check.stderr})
        require(retrieved_check.returncode == 0, "Retrieved artifact bytes failed verification")
        duplicate_after = host.call(arguments)
        require(duplicate_after["disposition"] == "existing" and
                duplicate_after["run"]["run_id"] == run_id and len(entries(output)) == 1,
                "Completed retry replayed the analysis")
        report = {"status": "passed", "run_id": run_id,
             "request_id": REQUEST, "entries": entries(output), "final": final,
             "retrieved": str(retrieved), "analysis_sha256": meta["analysis_sha256"],
             "duration_seconds": (time.time_ns() - meta["started_at_ns"]) / 1e9,
             "scientific_scope": "Independent input/design/arithmetic/file checks plus native saved-model observation; no independent refit or clinical/new causal claim"}
    except BaseException as error:
        failure = error
        save(evidence / "failure.json", {"type": type(error).__name__, "message": str(error),
                                        "time_ns": time.time_ns()})
    finally:
        if host is not None:
            try:
                cleanup = host.close()
                require(cleanup["exit_code"] == 0 and not cleanup["forced"] and cleanup["socket_removed"],
                        "Host cleanup failed")
                shutdown = cleanup.get("shutdown", {})
                require(not shutdown.get("not_confirmed") and shutdown.get("requests_still_open") == 0,
                        "Host shutdown left unconfirmed work")
            except BaseException as cleanup_error:
                save(evidence / "cleanup-failure.json", {"type": type(cleanup_error).__name__,
                     "message": str(cleanup_error), "time_ns": time.time_ns()})
                if failure is None:
                    failure = cleanup_error
    if failure is not None:
        raise failure
    save(evidence / "report.json", report)
    print(json.dumps({"status": "passed", "evidence": str(evidence), "artifacts": str(root / "retrieved")}), flush=True)


if __name__ == "__main__":
    main()
