"""Join reviewed requirement mappings to actual JUnit and coverage evidence.

Run --validate in CI to catch stale mappings. A passing mapped check is evidence
for its stated intent, never automatic acceptance of the entire requirement.
Missing, skipped and failed results remain visible and cannot become Pass.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LANES = ("backend", "frontend", "browser", "integrated")


def validate(manifest: dict, root: Path = ROOT) -> None:
    requirements = manifest["requirements"]
    expected = {f"CORE-{i:02d}" for i in range(1, 21)} | {f"W7-{i:02d}" for i in range(1, 7)}
    ids = [row["id"] for row in requirements]
    if set(ids) != expected or len(ids) != len(expected):
        raise ValueError("The checklist must contain each of the 20 core and six Week 7 IDs once.")
    for row in requirements:
        if not row.get("owner") or not row.get("intent") or "checks" not in row:
            raise ValueError(f"Incomplete requirement {row['id']}")
        if not row["checks"] and not row.get("gaps"):
            raise ValueError(f"Unmapped requirement needs an explicit gap: {row['id']}")
        for check in row["checks"]:
            if check["lane"] not in LANES:
                raise ValueError(f"Unknown lane: {check['lane']}")
            path = root / check["path"]
            if not path.is_file() or not check.get("test") or check["test"] not in path.read_text():
                raise ValueError(f"Stale test mapping: {row['id']} {check}")
        for path in row.get("sql", []):
            if not (root / path).is_file():
                raise ValueError(f"Missing SQL assertion file: {path}")


def read_junit(path: Path | None) -> list[dict]:
    if path is None or not path.is_file():
        return []
    result = []
    for case in ET.parse(path).iter("testcase"):
        status = "passed"
        for tag in ("skipped", "failure", "error"):
            if case.find(tag) is not None:
                status = {"skipped": "skipped", "failure": "failed", "error": "failed"}[tag]
        result.append({"class": case.get("classname", ""), "name": case.get("name", ""),
                       "status": status})
    return result


def evaluate(check: dict, cases: list[dict]) -> dict:
    path = Path(check["path"])
    classname = f"tests.{path.stem}" if check["lane"] == "backend" else path.name
    matched = [case for case in cases
               if (case["class"] == classname if check["lane"] == "backend"
                   else Path(case["class"]).name == classname)
               and (case["name"].split("[")[0] == check["test"]
                    if check["lane"] == "backend" else check["test"] in case["name"])]
    statuses = {case["status"] for case in matched}
    status = ("not executed" if not matched else "failed" if "failed" in statuses
              else "skipped" if "skipped" in statuses else "passed")
    return {**check, "status": status, "cases": matched}


def backend_coverage(path: Path | None) -> dict | None:
    if path is None or not path.is_file():
        return None
    source = json.loads(path.read_text())
    total = source["totals"]
    return {
        "statements": {"covered": total["covered_lines"], "total": total["num_statements"],
                       "percent": total.get("percent_statements_covered",
                           100 * total["covered_lines"] / max(total["num_statements"], 1))},
        "branches": {"covered": total.get("covered_branches"),
                     "total": total.get("num_branches"),
                     "percent": total.get("percent_branches_covered")},
        "excluded_lines": total["excluded_lines"],
        "uncovered": {
            file: {"lines": value["missing_lines"], "branches": value.get("missing_branches", [])}
            for file, value in source["files"].items()
            if value["missing_lines"] or value.get("missing_branches")
        },
    }


def source_digest(root: Path = ROOT) -> str:
    digest = hashlib.sha256()
    files = []
    for folder in ("api/app", "api/tests", "frontend/src", "frontend/e2e",
                   "frontend/integration", "scripts/qa"):
        files.extend(p for p in (root / folder).rglob("*")
                     if p.suffix in {".py", ".ts", ".tsx"})
    files.extend(root / p for p in (
        ".github/workflows/ci.yml", "docs/testing/requirements.json", "api/pyproject.toml",
        "frontend/package.json", "frontend/package-lock.json", "frontend/vitest.config.ts",
        "frontend/playwright.config.ts", "frontend/playwright.integrated.config.ts",
    ))
    for path in sorted(files):
        digest.update(str(path.relative_to(root)).encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def build_report(manifest: dict, evidence: dict, coverage: dict) -> dict:
    rows = []
    for row in manifest["requirements"]:
        checks = [evaluate(check, evidence[check["lane"]]) for check in row["checks"]]
        rows.append({**row, "checks": checks,
                     "mapped_checks_passed": bool(checks) and all(
                         c["status"] == "passed" for c in checks),
                     "acceptance": "gap recorded" if row["gaps"] else "human acceptance pending"})
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "all_requirements_accepted": False,
        "meaning": "Mapped checks prove only their stated intent. Human acceptance is separate.",
        "suites": {lane: dict(Counter(c["status"] for c in cases))
                   for lane, cases in evidence.items()},
        "coverage": coverage,
        "requirements": rows,
    }


def markdown(report: dict) -> str:
    lines = ["# Release requirement verification", "",
             "Complete release coverage is not established. Passing mapped checks support the "
             "listed intent; they do not approve an entire feature or close a recorded gap.", "",
             f"Generated {report['generated_at']}. Source baseline `{report['revision']}`; "
             f"verification source SHA256 `{report['source_sha256']}`.", "",
             "## Executed suites", "", "| Suite | Passed | Failed | Skipped |",
             "| --- | ---: | ---: | ---: |"]
    for lane, counts in report["suites"].items():
        lines.append(f"| {lane} | {counts.get('passed', 0)} | {counts.get('failed', 0)} "
                     f"| {counts.get('skipped', 0)} |")
    lines += ["", "An empty suite means execution evidence was not supplied; it is not a pass.",
              "", "## Code coverage", "",
              "| Scope | Statements | Branches |", "| --- | ---: | ---: |"]
    backend = report["coverage"].get("backend")
    frontend = report["coverage"].get("frontend_unit")
    if backend:
        lines.append(f"| Backend app | {backend['statements']['percent']:.2f}% "
                     f"| {backend['branches']['percent']:.2f}% |"
                     if backend["branches"]["percent"] is not None else
                     f"| Backend app | {backend['statements']['percent']:.2f}% | Not measured |")
    if frontend:
        lines.append(f"| Frontend src unit suite | {frontend['statements']['pct']:.2f}% "
                     f"| {frontend['branches']['pct']:.2f}% |")
    lines += ["", report["coverage"].get("frontend_note", ""), ""]
    lines += ["", "## Requirement checklist", "",
              "SQL paths identify additional assertions; SQL execution is recorded separately "
              "by the disposable harness exit result and log.", ""]
    for row in report["requirements"]:
        lines += [f"### {row['id']} {row['name']}", "",
                  f"Owner: {row['owner']}. Stories: {', '.join(row['stories'])}.", "",
                  row["intent"], "", "| Layer | Executable check | Actual result |",
                  "| --- | --- | --- |"]
        for check in row["checks"]:
            lines.append(f"| {check['lane']} | `{check['path']}::{check['test']}` "
                         f"| {check['status']} ({len(check['cases'])} cases) |")
        lines += ["", "Acceptance: " + row["acceptance"] + ".", ""]
        for gap in row["gaps"]:
            lines.append(f"- {gap}")
        if row.get("sql"):
            lines += ["", "SQL assertions: " + ", ".join(f"`{p}`" for p in row["sql"]) + "."]
        lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "docs/testing/requirements.json")
    parser.add_argument("--validate", action="store_true")
    parser.add_argument("--output-dir", type=Path)
    for lane in LANES:
        parser.add_argument(f"--{lane}-junit", type=Path)
    parser.add_argument("--backend-coverage", type=Path)
    parser.add_argument("--frontend-coverage", type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    validate(manifest)
    if args.validate:
        print("26 requirement mappings validated; this does not claim execution or acceptance.")
        return
    if args.output_dir is None:
        parser.error("--output-dir is required unless --validate is used")
    evidence = {lane: read_junit(getattr(args, f"{lane}_junit")) for lane in LANES}
    frontend = (json.loads(args.frontend_coverage.read_text())["total"]
                if args.frontend_coverage and args.frontend_coverage.is_file() else None)
    report = build_report(manifest, evidence, {
        "backend": backend_coverage(args.backend_coverage), "frontend_unit": frontend,
        "frontend_note": "All src TS/TSX included. Browser execution is not instrumented here. "
                         "V8 branch/function denominators do not prove unexecuted UI branches.",
    })
    report["revision"] = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    report["source_sha256"] = source_digest()
    report["working_tree_dirty"] = bool(subprocess.check_output(
        ["git", "status", "--porcelain"], cwd=ROOT, text=True).strip())
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "requirements.json").write_text(json.dumps(report, indent=2) + "\n")
    (args.output_dir / "requirements.md").write_text(markdown(report))
    print(json.dumps({"suites": report["suites"], "mapped_requirements": len(report["requirements"]),
                      "all_requirements_accepted": False}, indent=2))


if __name__ == "__main__":
    main()
