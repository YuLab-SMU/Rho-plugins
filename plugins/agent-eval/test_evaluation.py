"""Owner-check failures, budgets and evidence retention; no model credentials."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("owner_eval", Path(__file__).with_name("run.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class OwnerEvaluation(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.script = self.root / "checker.py"
        self.case = {"id": "owner-fixture", "scope": "fixture facts", "not_scored": ["Agent autonomy"],
                     "command": [sys.executable, str(self.script), "{report}"]}

    def evaluate(self, source, **options):
        self.script.write_text(source)
        with patch("builtins.print"):
            passed = runner.evaluate(self.case, self.root / "evidence", **options)
        report = json.loads((self.root / "evidence/trial-1/report.json").read_text())
        return passed, report

    def test_success_preserves_native_report_and_scope(self):
        passed, report = self.evaluate("import pathlib,sys\npathlib.Path(sys.argv[1]).write_text('{\"passed\":true,\"checks\":[{\"status\":\"pass\"}]}')\nprint('native evidence')\n")
        self.assertTrue(passed)
        self.assertEqual(report["checks"], [{"status": "pass"}])
        self.assertEqual(report["not_scored"], ["Agent autonomy"])
        self.assertEqual((self.root / "evidence/trial-1/stdout.txt").read_text(), "native evidence\n")
        with self.assertRaises(FileExistsError):
            runner.evaluate(self.case, self.root / "evidence")

    def test_missing_or_false_or_malformed_report_is_not_a_pass(self):
        for source in ("pass", "import pathlib,sys\npathlib.Path(sys.argv[1]).write_text('{\"passed\":false}')",
                       "import pathlib,sys\npathlib.Path(sys.argv[1]).write_text('not JSON')"):
            with tempfile.TemporaryDirectory() as directory, patch("builtins.print"):
                self.script.write_text(source)
                destination = Path(directory) / "evidence"
                self.assertFalse(runner.evaluate(self.case, destination, trials=2))
                summary = json.loads((destination / "summary.json").read_text())
                self.assertEqual((summary["passed"], summary["total"], summary["completed_trials"]), (0, 2, 2))

    def test_native_failure_cannot_be_overridden_by_positive_report(self):
        passed, report = self.evaluate("import pathlib,sys\npathlib.Path(sys.argv[1]).write_text('{\"passed\":true}')\nsys.exit(1)")
        self.assertFalse(passed)
        self.assertTrue(report["owner_passed"])
        self.assertEqual(report["exit_code"], 1)

    def test_timeout_stops_checker_and_retains_failure(self):
        passed, report = self.evaluate("import time\nprint('before timeout',flush=True)\ntime.sleep(10)", timeout=.1)
        self.assertFalse(passed)
        self.assertIn("TimeoutError", report["runtime_error"])
        execution = json.loads((self.root / "evidence/trial-1/execution.json").read_text())
        self.assertIsNotNone(execution["exit_code"])
        self.assertLess(execution["elapsed_seconds"], 3)

    def test_output_budget_retains_exact_bound_and_fails(self):
        passed, report = self.evaluate("print('x'*10000,flush=True)", max_output=1024)
        self.assertFalse(passed)
        self.assertIn("retention budget", report["runtime_error"])
        self.assertEqual((self.root / "evidence/trial-1/stdout.txt").stat().st_size, 1024)

    def test_input_identity_change_rejects_otherwise_positive_result(self):
        identity = self.root / "identity.txt"
        identity.write_text("original")
        self.case["identity_files"] = [str(identity)]
        passed, report = self.evaluate("import pathlib,sys\npathlib.Path(sys.argv[1]).write_text('{\"passed\":true}')\npathlib.Path(" + repr(str(identity)) + ").write_text('changed')")
        self.assertFalse(passed)
        self.assertFalse(report["input_identity_unchanged"])

    def test_interruption_keeps_planned_denominator_and_partial_failure(self):
        self.script.write_text("pass")
        with patch.object(runner, "run_checker", side_effect=KeyboardInterrupt), patch("builtins.print"):
            with self.assertRaises(KeyboardInterrupt):
                runner.evaluate(self.case, self.root / "evidence", trials=3)
        summary = json.loads((self.root / "evidence/summary.json").read_text())
        self.assertEqual((summary["passed"], summary["total"], summary["completed_trials"], summary["not_run_trials"]), (0, 3, 1, 2))
        self.assertIn("KeyboardInterrupt", summary["results"][0]["runtime_error"])


if __name__ == "__main__":
    unittest.main()
