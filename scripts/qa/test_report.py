"""Evidence-tool regressions: incomplete or failed evidence must never become Pass."""

import tempfile
import unittest
from pathlib import Path

from report import build_report, evaluate, read_junit

CHECK = {"lane": "backend", "path": "api/tests/test_capacity.py", "test": "test_last_place"}


class EvidenceTests(unittest.TestCase):
    def test_unexecuted_mapping_is_not_passed(self):
        self.assertEqual(evaluate(CHECK, [
            {"class": "tests.test_other", "name": "test_last_place", "status": "passed"},
        ])["status"], "not executed")

    def test_every_parameterised_outcome_must_pass(self):
        cases = [
            {"class": "tests.test_capacity", "name": "test_last_place[1]", "status": "passed"},
            {"class": "tests.test_capacity", "name": "test_last_place[2]", "status": "failed"},
        ]
        self.assertEqual(evaluate(CHECK, cases)["status"], "failed")
        cases[1]["status"] = "skipped"
        self.assertEqual(evaluate(CHECK, cases)["status"], "skipped")

    def test_junit_error_and_skip_are_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "results.xml"
            path.write_text('<testsuites><testsuite><testcase name="ok"/>'
                            '<testcase name="bad"><error message="timeout"/></testcase>'
                            '<testcase name="later"><skipped/></testcase>'
                            '</testsuite></testsuites>')
            self.assertEqual([c["status"] for c in read_junit(path)],
                             ["passed", "failed", "skipped"])

    def test_missing_result_is_not_an_empty_successful_suite(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(read_junit(Path(folder) / "missing.xml"), [])
        self.assertEqual(evaluate(CHECK, [])["status"], "not executed")

    def test_passing_tests_do_not_close_an_acceptance_gap(self):
        row = {"id": "CORE-18", "checks": [CHECK], "gaps": ["Roster absent"]}
        evidence = {"backend": [{"class": "tests.test_capacity",
                                 "name": "test_last_place", "status": "passed"}]}
        report = build_report({"requirements": [row]}, evidence, {})
        self.assertTrue(report["requirements"][0]["mapped_checks_passed"])
        self.assertEqual(report["requirements"][0]["acceptance"], "gap recorded")
        self.assertFalse(report["all_requirements_accepted"])

    def test_unmapped_requirement_is_not_vacuously_covered(self):
        row = {"id": "W7-02", "checks": [], "gaps": ["No implementation"]}
        report = build_report({"requirements": [row]}, {}, {})
        self.assertFalse(report["requirements"][0]["mapped_checks_passed"])


if __name__ == "__main__":
    unittest.main()
