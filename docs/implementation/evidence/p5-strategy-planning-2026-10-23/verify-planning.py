"""Verify planning-only changes against the post-push P4 baseline."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
from urllib.parse import unquote

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
BASELINE = json.loads((HERE / "baseline.json").read_text())
PLAN = ROOT / "docs/implementation/small-portfolio-p5-implementation-plan-2026-10-23.md"
TRACKER = ROOT / "docs/implementation/small-portfolio-phase-tracker-2026-10-23.md"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


dirty_mismatches = [row["path"] for row in BASELINE["dirtyFiles"]
                    if digest(ROOT / row["path"]) != row["sha256"]]
protected_mismatches = [name for name, expected in BASELINE["protectedHashes"].items()
                        if digest(ROOT / name) != expected]
before = {row["path"] for row in BASELINE["dirtyFiles"]}
current = set(subprocess.check_output(
    ["git", "ls-files", "--modified", "--others", "--exclude-standard", "-z"],
    cwd=ROOT).decode().strip("\0").split("\0"))
allowed = {str(PLAN.relative_to(ROOT)), str(TRACKER.relative_to(ROOT))}
prefix = str(HERE.relative_to(ROOT)) + "/"
unexpected = sorted(p for p in current - before if p not in allowed and not p.startswith(prefix))
missing_links = []
for doc in [PLAN, TRACKER, HERE / "references.md", HERE / "README.md"]:
    for target in re.findall(r"\]\(([^)]+)\)", doc.read_text()):
        target = target.strip("<>").split("#", 1)[0]
        if not target or re.match(r"[a-zA-Z]+://", target):
            continue
        local = Path(unquote(target))
        local = local if local.is_absolute() else doc.parent / local
        if not local.exists():
            missing_links.append({"document": str(doc.relative_to(ROOT)), "target": target})
for path in HERE.glob("*.json"):
    json.loads(path.read_text())
tracker = TRACKER.read_text()
phase_rows = {f"P{i}": len(re.findall(rf"^\| P{i} ", tracker, re.M)) for i in range(8)}
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
remote = subprocess.check_output(
    ["git", "rev-parse", "refs/remotes/origin/codex/operations-crew-journal"],
    cwd=ROOT, text=True).strip()
report = {
    "p4Commit": head,
    "p4RemoteTrackingRef": remote,
    "p4RefsMatchExpectedPush": head == remote == BASELINE["base"],
    "preexistingDirtyEntries": len(before),
    "byteIdenticalDirtyEntries": len(before) - len(dirty_mismatches),
    "dirtyMismatches": dirty_mismatches,
    "protectedHashCount": len(BASELINE["protectedHashes"]),
    "protectedMismatches": protected_mismatches,
    "unexpectedPlanningChanges": unexpected,
    "allPhaseRowsRetainedOnce": all(v == 1 for v in phase_rows.values()),
    "phaseRows": phase_rows,
    "missingLocalLinks": missing_links,
    "jsonParsed": True,
    "applicationCodeWrittenForP5": False,
    "marketEvaluationPerformed": False,
    "planSha256": digest(PLAN),
    "trackerSha256": digest(TRACKER),
}
report["passed"] = (report["p4RefsMatchExpectedPush"] and not dirty_mismatches
                    and not protected_mismatches and not unexpected
                    and not missing_links and report["allPhaseRowsRetainedOnce"])
(HERE / "preservation.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
if not report["passed"]:
    raise SystemExit(1)
