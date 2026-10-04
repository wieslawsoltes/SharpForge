"""A25 native Chromium storage qualification using the repository's pinned Python Playwright.

The fixture runs through real HTTP with production CSP. No storage implementation,
worker implementation or browser permission is replaced by a test double. The
quota case injects an operation failure into an otherwise native IDB transaction.
"""
import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import queue
import subprocess
import sys
import threading
import time
import traceback

from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir


ROOT = Path(__file__).resolve().parents[1]
CASES = ("memory", "indexeddb", "opfs", "persistence", "quota", "fallback", "filesystem", "credentials")


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--screenshot", type=Path)
    parser.add_argument("--count", type=int, default=50000)
    parser.add_argument("--cases", default=",".join(CASES))
    parser.add_argument("--timeout-ms", type=int, default=1200000)
    options = parser.parse_args()
    options.cases = tuple(options.cases.split(","))
    if not 1 <= options.count <= 1000000:
        parser.error("--count must be 1..1000000")
    if options.timeout_ms < 1000:
        parser.error("--timeout-ms must be at least 1000")
    if any(name not in CASES for name in options.cases):
        parser.error("--cases accepts " + ",".join(CASES))
    if options.output is None:
        options.output = results_dir() / "a25-storage-browser-results.json"
    elif not options.output.is_absolute():
        parser.error("--output must name an absolute evidence path")
    options.screenshot = options.screenshot or options.output.with_name(options.output.stem + "-ready.png")
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.screenshot.parent.mkdir(parents=True, exist_ok=True)
    return options


def start_server():
    node = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or "node"
    process = subprocess.Popen(
        [node, str(ROOT / "scripts/a25-storage-browser-server.mjs")],
        cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8"
    )
    startup = queue.Queue()
    threading.Thread(target=lambda: startup.put(process.stdout.readline()), daemon=True).start()
    try:
        line = startup.get(timeout=30)
        if not line:
            _, error = process.communicate(timeout=5)
            raise RuntimeError("Storage fixture server did not start: " + error)
        metadata = json.loads(line)
        return process, metadata
    except BaseException:
        process.terminate()
        process.wait(timeout=5)
        raise


def stop_server(process):
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def fixture_ready(page, url, reload=False):
    if reload:
        page.reload(wait_until="load", timeout=30000)
    else:
        page.goto(url, wait_until="load", timeout=30000)
    page.get_by_text("Ready", exact=True).wait_for(state="visible", timeout=30000)
    if not page.evaluate("() => Boolean(window.gitStorageAcceptance)"):
        raise AssertionError("Storage fixture did not initialize")


def invoke(page, method, values, timeout):
    return page.evaluate("""async ({method, values, timeout}) => {
        let timer;
        try {
            return await Promise.race([
                window.gitStorageAcceptance[method](values),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`${method} exceeded ${timeout} ms`)), timeout);
                })
            ]);
        } finally { clearTimeout(timer); }
    }""", {"method": method, "values": values, "timeout": timeout})


def run_checks(page, session, url, options, report):
    def check(name, callback):
        session.check_cancelled()
        started = time.monotonic()
        print(json.dumps({"state": "running", "case": name}), flush=True)
        try:
            result = callback()
            report["checks"].append({"name": name, "passed": True, "result": result,
                                     "elapsedMs": (time.monotonic() - started) * 1000})
            print(json.dumps({"state": "passed", "case": name}), flush=True)
        except BaseException:
            report["checks"].append({"name": name, "passed": False, "error": traceback.format_exc(),
                                     "elapsedMs": (time.monotonic() - started) * 1000})
            raise

    for backend in ("memory", "indexeddb", "opfs"):
        if backend not in options.cases:
            continue

        def conformance(backend=backend):
            result = invoke(page, "conformance", {"backend": backend}, options.timeout_ms)
            expected = "opfs-sync-worker" if backend == "opfs" else backend
            if result["backend"] != expected:
                raise AssertionError(f"Expected actual {expected}; received {result['backend']}")
            if backend == "opfs" and not any(url.endswith("/opfs-worker.js") for url in report["workers"]):
                raise AssertionError("No actual OPFS module worker was observed")
            return result

        check(backend + "-conformance", conformance)
    if "persistence" in options.cases:
        values = {"backend": "indexeddb", "repositoryId": "a25-native-persistence", "count": options.count}
        check("indexeddb-object-persistence-write", lambda: invoke(
            page, "run", {**values, "phase": "write"}, options.timeout_ms
        ))
        fixture_ready(page, url, reload=True)
        report["persistenceReloaded"] = True
        check("indexeddb-object-persistence-reload-read", lambda: invoke(
            page, "run", {**values, "phase": "read"}, options.timeout_ms
        ))
    if "credentials" in options.cases:
        check("credential-native-persistence-write-and-plaintext-scan", lambda: invoke(
            page, "runCredentialVault", {"phase": "write"}, options.timeout_ms
        ))
        fixture_ready(page, url, reload=True)
        report["credentialPersistenceReloaded"] = True
        check("credential-native-reload-tamper-isolation-and-logout", lambda: invoke(
            page, "runCredentialVault", {"phase": "read"}, options.timeout_ms
        ))
    simple = (("quota", "indexeddb-quota-atomic-rollback", "runQuota"),
              ("fallback", "unsupported-opfs-indexeddb-fallback", "runFallback"),
              ("filesystem", "filesystem-access-opfs-directory-handle", "runFileSystem"))
    for selected, name, method in simple:
        if selected in options.cases:
            check(name, lambda method=method: invoke(page, method, {}, options.timeout_ms))


def browser_run(options, report, server_metadata):
    if os.environ.get("SHARPFORGE_IN_MEMORY") == "1":
        raise RuntimeError("A25 storage qualification requires native HTTP storage; memory emulation cannot qualify")
    with sync_playwright() as playwright, launch_browser(playwright, __file__, engine="chromium") as session:
        report["environment"] = {
            "python": platform.python_version(), "platform": platform.platform(), "engine": "chromium",
            "browserVersion": session.version, "playwrightVersion": importlib.metadata.version("playwright"),
            "executable": os.environ.get("CHROMIUM_EXECUTABLE") or playwright.chromium.executable_path
        }
        context = session.new_context(viewport={"width": 1100, "height": 720})
        page = context.new_page()
        page.on("pageerror", lambda error: report["pageErrors"].append(error.stack or str(error)))
        page.on("requestfailed", lambda request: report["requestFailures"].append({
            "url": request.url, "error": request.failure
        }))
        page.on("worker", lambda worker: report["workers"].append(worker.url))
        url = server_metadata["origin"] + "/tests/a25-storage-browser.html"
        fixture_ready(page, url)
        page.screenshot(path=str(options.screenshot), full_page=True)
        try:
            run_checks(page, session, url, options, report)
            if report["pageErrors"] or report["requestFailures"]:
                raise AssertionError("Browser emitted a page or request error; inspect recorded evidence")
            session.csp.assert_clean()
            report["cspViolations"] = session.csp.events
        except BaseException:
            failure_path = options.output.with_name(options.output.stem + "-failure.png")
            try:
                page.screenshot(path=str(failure_path), timeout=5000)
                report["failureScreenshot"] = str(failure_path)
            except Exception as error:
                report["screenshotError"] = str(error)
            raise


def main():
    options = arguments()
    report = {
        "schemaVersion": 1, "suite": "SF-A25-storage-browser", "passed": False,
        "implementationHead": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "checks": [], "pageErrors": [],
        "requestFailures": [], "workers": [], "selectedCases": options.cases, "persistenceObjectCount": options.count,
        "storage": "native browser IndexedDB and OPFS; no storage emulation", "screenshot": str(options.screenshot)
    }
    server = None
    try:
        server, metadata = start_server()
        report.update({"origin": metadata["origin"], "csp": metadata["csp"]})
        browser_run(options, report, metadata)
        report["passed"] = True
        report["fullStorageScope"] = all(name in options.cases for name in CASES) and options.count >= 50000
    except BaseException:
        report["failure"] = traceback.format_exc()
        traceback.print_exc()
    finally:
        stop_server(server)
        report["completedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        options.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "checks": len(report["checks"]), "evidence": str(options.output)}), flush=True)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
