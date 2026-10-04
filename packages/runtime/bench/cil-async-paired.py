"""Export pinned runtime sources, then run sequential ABI measurements or one baseline assertion."""

import argparse
import hashlib
import io
import json
import math
import os
from pathlib import Path
import platform
import statistics
import subprocess
import tarfile
import tempfile
import time

BASELINE = "eadd85149b0740f337f7b8f3e92d259353892fdb"
RUNNER = "packages/runtime/bench/cil-async.mjs"
FIXTURE = "tests/managed-fixtures.js"
DISPATCH = "tests/a05-02-generic-dispatch.test.js"
DISPATCH_SUPPORT = "tests/support/generic-call-fixture.js"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(repository, *args):
    return subprocess.check_output(["git", "-C", str(repository), *args])


def revision(repository, value):
    result = git(repository, "rev-parse", "--verify", "--end-of-options", value + "^{commit}").decode().strip()
    if result != value:
        raise ValueError("Supply an exact full commit SHA: " + value)
    return result


def export_sources(repository, commit, destination, extras):
    packages = {}
    pending = ["runtime"]
    while pending:
        name = pending.pop()
        if name in packages:
            continue
        manifest = json.loads(git(repository, "show", commit + ":packages/" + name + "/package.json"))
        if manifest["name"] != "@sharpforge/" + name:
            raise ValueError("Unexpected workspace identity")
        packages[name] = manifest
        for dependency in manifest.get("dependencies", {}):
            if not dependency.startswith("@sharpforge/"):
                raise ValueError("Export does not fetch external executable dependencies")
            pending.append(dependency.removeprefix("@sharpforge/"))
    paths = ["package.json", *extras]
    for name in sorted(packages):
        paths.extend(["packages/" + name + "/package.json", "packages/" + name + "/src"])
    archive = git(repository, "archive", "--format=tar", commit, *paths)
    files = []
    with tarfile.open(fileobj=io.BytesIO(archive)) as source:
        for member in source:
            if member.isdir():
                continue
            if not member.isfile() or Path(member.name).is_absolute() or ".." in Path(member.name).parts:
                raise ValueError("Unexpected non-regular source export entry")
            data = source.extractfile(member).read()
            target = destination / member.name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            files.append({"path": member.name, "sha256": digest(data), "bytes": len(data)})
    aliases = destination / "node_modules/@sharpforge"
    aliases.mkdir(parents=True)
    for name in packages:
        (aliases / name).symlink_to(destination / "packages" / name, target_is_directory=True)
        if (aliases / name).resolve() != destination / "packages" / name:
            raise ValueError("Workspace alias leaves its export")
    return {"commit": commit, "tree": git(repository, "rev-parse", commit + "^{tree}").decode().strip(),
            "files": files, "bytes": sum(item["bytes"] for item in files), "packages": sorted(packages)}


def verify_export(directory, inventory):
    for item in inventory["files"]:
        if digest((directory / item["path"]).read_bytes()) != item["sha256"]:
            raise ValueError("Export source changed during qualification: " + item["path"])


def run(directory, args, commit, timeout=180):
    environment = dict(os.environ, SHARPFORGE_BENCH_REVISION=commit)
    started = time.monotonic()
    process = subprocess.run(["node", *args], cwd=directory, env=environment,
                             capture_output=True, text=True, timeout=timeout)
    return {"command": ["node", *args], "exitCode": process.returncode, "elapsedSeconds": time.monotonic() - started,
            "stdout": process.stdout, "stderr": process.stderr}


def summaries(rounds):
    groups = {}
    for item in rounds:
        for case in item["result"]["cases"]:
            key = (item["revision"], case["name"])
            group = groups.setdefault(key, {"name": case["name"], "revision": item["revision"],
                                           "status": case["status"], "assemblySha256": case["assemblySha256"], "samples": []})
            if group["status"] != case["status"] or group["assemblySha256"] != case["assemblySha256"]:
                raise ValueError("Paired run changed status or fixture identity")
            group["samples"].extend(case.get("samples", []))
    result = []
    for group in groups.values():
        samples = group.pop("samples")
        group["sampleCount"] = len(samples)
        if samples:
            group["metrics"] = {}
            for key in samples[0]:
                values = sorted(sample[key] for sample in samples)
                group["metrics"][key] = {"median": statistics.median(values),
                                          "p95": values[math.ceil(len(values) * 0.95) - 1]}
        result.append(group)
    return result


def comparisons(summary):
    by_case = {}
    for item in summary:
        by_case.setdefault(item["name"], {})[item["revision"]] = item
    result = []
    for name, versions in by_case.items():
        if len(versions) != 2 or any(item["status"] != "measured" for item in versions.values()):
            continue
        metrics = {}
        for key, baseline in versions["A"]["metrics"].items():
            candidate = versions["B"]["metrics"][key]
            metrics[key] = {"baseline": baseline, "candidate": candidate,
                            "medianPercentChange": (candidate["median"] / baseline["median"] - 1) * 100
                            if baseline["median"] else None}
        result.append({"name": name, "metrics": metrics})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["benchmark", "dispatch-baseline"])
    parser.add_argument("--repository", type=Path, default=Path(__file__).resolve().parents[3])
    parser.add_argument("--candidate")
    parser.add_argument("--capture", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    options = parser.parse_args()
    repository = options.repository.resolve()
    baseline = revision(repository, BASELINE)
    report = {"mode": options.mode, "baseline": baseline, "startedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "environment": {"platform": platform.platform(), "machine": platform.machine(), "cpus": os.cpu_count(),
                              "loadAverage": os.getloadavg() if hasattr(os, "getloadavg") else None}, "runs": []}
    with tempfile.TemporaryDirectory(prefix="sharpforge-async-pair-", dir=options.output.resolve().parent) as temporary:
        root = Path(temporary)
        if options.mode == "dispatch-baseline":
            directory = root / "baseline"
            inventory = export_sources(repository, baseline, directory, [DISPATCH, DISPATCH_SUPPORT])
            verify_export(directory, inventory)
            report["source"] = inventory
            report["runs"].append(run(directory, ["--test", "--test-name-pattern",
                "aggregate generic values and external generic methods keep explicit unsupported diagnostics", DISPATCH], baseline))
            verify_export(directory, inventory)
        else:
            if not options.candidate or not options.capture:
                parser.error("benchmark requires --candidate and --capture")
            candidate = revision(repository, options.candidate)
            runner, fixture = (git(repository, "show", candidate + ":" + path) for path in [RUNNER, FIXTURE])
            report.update(candidate=candidate, runnerSha256=digest(runner), fixtureSha256=digest(fixture), order=["A", "B", "B", "A"])
            exports = {}
            for label, commit in [("A", baseline), ("B", candidate)]:
                directory = root / label
                inventory = export_sources(repository, commit, directory, [])
                for path, content in [(RUNNER, runner), (FIXTURE, fixture)]:
                    (directory / path).parent.mkdir(parents=True, exist_ok=True)
                    (directory / path).write_bytes(content)
                    inventory["files"].append({"path": path, "sha256": digest(content), "bytes": len(content)})
                exports[label] = (directory, inventory)
            report["sources"] = {label: data[1] for label, data in exports.items()}
            for label in report["order"]:
                directory, inventory = exports[label]
                verify_export(directory, inventory)
                measured = run(directory, [RUNNER, str(options.capture.resolve())], inventory["commit"])
                measured["revision"] = label
                if measured["exitCode"] == 0:
                    measured["result"] = json.loads(measured["stdout"])
                report["runs"].append(measured)
                verify_export(directory, inventory)
                if measured["exitCode"]:
                    break
            if all("result" in item for item in report["runs"]):
                report["summary"] = summaries(report["runs"])
                identities = {}
                for item in report["summary"]:
                    previous = identities.setdefault(item["name"], item["assemblySha256"])
                    if previous != item["assemblySha256"]:
                        raise ValueError("Baseline and candidate did not measure identical fixture bytes")
                report["comparisons"] = comparisons(report["summary"])
                if any(item["revision"] == "B" and item["status"] != "measured" for item in report["summary"]):
                    report["qualificationError"] = "Candidate rejected an ABI fixture; performance qualification is incomplete"
    options.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"output": str(options.output), "runs": len(report["runs"]),
                      "exitCodes": [item["exitCode"] for item in report["runs"]]}, indent=2))
    return 1 if report.get("qualificationError") or any(item["exitCode"] for item in report["runs"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
