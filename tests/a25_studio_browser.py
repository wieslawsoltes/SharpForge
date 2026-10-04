"""Qualify built Studio Git workflows and the production 10k history renderer in native Chromium.

Run after the complete scope has been integrated and built. Evidence distinguishes
the built Studio UI from the isolated source-component performance fixture; both
use actual module workers and Git implementations, with no canned RPC responses.
"""
import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time
import traceback

from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir
from browser_harness import wait_condition
from a25_storage_browser import start_server, stop_server
from a25_studio_workflow import StudioWorkflow, require


ROOT = Path(__file__).resolve().parents[1]
CASES = ("studio", "graph")


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--cases", default=",".join(CASES))
    parser.add_argument("--count", type=int, default=10000)
    parser.add_argument("--scroll-steps", type=int, default=120)
    parser.add_argument("--timeout-ms", type=int, default=1200000)
    options = parser.parse_args()
    options.cases = tuple(options.cases.split(","))
    if not options.cases or any(name not in CASES for name in options.cases):
        parser.error("--cases accepts " + ",".join(CASES))
    if not 32 <= options.count <= 10000:
        parser.error("--count must be 32..10000")
    if not 60 <= options.scroll_steps <= 1200:
        parser.error("--scroll-steps must be 60..1200")
    if options.timeout_ms < 1000:
        parser.error("--timeout-ms must be at least 1000")
    if options.output is None:
        options.output = results_dir() / "a25-studio-browser-results.json"
    elif not options.output.is_absolute():
        parser.error("--output must name an absolute evidence path")
    options.output.parent.mkdir(parents=True, exist_ok=True)
    return options


def observe(page, report, scope):
    page.set_default_timeout(30000)
    page.on("pageerror", lambda error: report["pageErrors"].append({"scope": scope, "error": error.stack or str(error)}))
    page.on("requestfailed", lambda request: report["requestFailures"].append({
        "scope": scope, "url": request.url, "error": request.failure
    }))
    page.on("worker", lambda worker: report["workers"].append(worker.url))

    def dialog_opened(dialog):
        accepted = dialog.type == "confirm" and dialog.message.startswith("Load the selected Git worktree into Studio?")
        report["dialogs"].append({"scope": scope, "type": dialog.type, "message": dialog.message, "accepted": accepted})
        if accepted:
            dialog.accept()
        else:
            dialog.dismiss()
            report["unexpectedDialogs"].append(dialog.message)

    page.on("dialog", dialog_opened)


def invoke(page, method, values, timeout):
    return page.evaluate("""async ({method, values, timeout}) => {
        let timer;
        try {
            return await Promise.race([
                window.gitUiAcceptance[method](values),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeout); })
            ]);
        } finally { clearTimeout(timer); }
    }""", {"method": method, "values": values, "timeout": timeout})


def run_graph(page, session, metadata, options, report):
    workflow = StudioWorkflow(page, session, report, options.output)
    url = metadata["origin"] + "/tests/a25-ui-browser.html"
    response = page.goto(url, wait_until="load")
    require(response.status == 200, "History fixture navigation failed")
    require(response.headers.get("content-security-policy") == metadata["csp"], "History fixture did not use production CSP")
    page.get_by_text("Ready", exact=True).wait_for()
    report["graphFixture"] = {"url": url, "component": "apps/studio/git-history-view.js",
                              "objects": "actual memory object database in a dedicated worker", "csp": metadata["csp"]}

    def seed_and_render():
        result = invoke(page, "runGraph", {"count": options.count}, options.timeout_ms)
        require(result["seeded"]["generatedInWorker"], "History generation did not execute in a worker")
        require(any(url.endswith("/a25-ui-browser-worker.js") for url in report["workers"]),
                "No actual graph module worker was observed")
        workflow.screenshot("graph-ready")
        return result

    def scroll():
        result = invoke(page, "scrollGraph", {"steps": options.scroll_steps}, options.timeout_ms)
        report["graphPerformance"] = result
        workflow.screenshot("graph-scrolled")
        require(result["meetsTarget"], "Actual scrolling missed the recorded 60 Hz target; inspect frame timing evidence")
        return result

    def selected_diff():
        result = invoke(page, "selectRoot", {}, options.timeout_ms)
        workflow.screenshot("graph-root-diff")
        return result

    def keyboard_and_filter():
        viewport = page.get_by_role("listbox", name="Commit history", exact=True)
        viewport.focus()
        viewport.press("Home")
        newest = "Graph fixture commit " + str(options.count - 1).zfill(5)
        page.locator('.git-commit-detail').get_by_role("heading", name=newest, exact=True).wait_for()
        viewport.press("End")
        page.locator('.git-commit-detail').get_by_role("heading", name="Graph fixture commit 00000", exact=True).wait_for()
        page.get_by_role("searchbox", name="Search commits", exact=True).fill("Graph fixture commit 00000")
        wait_condition(page, 'window.gitUiAcceptance.inspect().viewport.liveRows === 1')
        filtered = page.evaluate('window.gitUiAcceptance.inspect()')
        require(filtered["visibleMessages"] == ["Graph fixture commit 00000"], "History filter selected the wrong commit")
        page.get_by_role("searchbox", name="Search commits", exact=True).fill("")
        wait_condition(page, 'window.gitUiAcceptance.inspect().viewport.liveRows > 1')
        return {"filter": filtered, "keyboard": "Home and End selected the real newest and oldest commits"}

    try:
        workflow.check("graph-actual-worker-objects-and-production-renderer", seed_and_render)
        workflow.check("graph-virtual-scroll-60hz-measurement", scroll)
        workflow.check("graph-selected-root-commit-real-diff", selected_diff)
        workflow.check("graph-keyboard-and-message-filter", keyboard_and_filter)
        require(not page.evaluate('window.gitUiAcceptance.inspect().errors'), "History fixture reported a handled error")
    finally:
        invoke(page, "dispose", {}, 30000)


def browser_run(options, report):
    if os.environ.get("SHARPFORGE_IN_MEMORY") == "1":
        raise RuntimeError("A25 Studio qualification requires native HTTP, IndexedDB and workers; memory emulation cannot qualify")
    if "studio" in options.cases and not (ROOT / "dist/git-worker.js").is_file():
        raise RuntimeError("The complete Studio scope must be built before browser qualification (dist/git-worker.js is missing)")
    server = None
    try:
        with sync_playwright() as playwright, launch_browser(playwright, __file__, engine="chromium") as session:
            report["environment"] = {"python": platform.python_version(), "platform": platform.platform(), "engine": "chromium",
                                     "browserVersion": session.version, "playwrightVersion": importlib.metadata.version("playwright"),
                                     "executable": os.environ.get("CHROMIUM_EXECUTABLE") or playwright.chromium.executable_path}
            page = None
            try:
                if "studio" in options.cases:
                    context = session.new_context(viewport={"width": 1600, "height": 1100})
                    page = context.new_page()
                    observe(page, report, "built-studio")
                    StudioWorkflow(page, session, report, options.output).run()
                if "graph" in options.cases:
                    server, metadata = start_server()
                    context = session.new_context(viewport={"width": 1400, "height": 1120})
                    page = context.new_page()
                    observe(page, report, "source-history-component")
                    run_graph(page, session, metadata, options, report)
                require(not report["pageErrors"], "Browser emitted a page error; inspect recorded evidence")
                require(not report["requestFailures"], "Browser emitted a failed request; inspect recorded evidence")
                require(not report["unexpectedDialogs"], "Browser showed an unexpected dialog; inspect recorded evidence")
                session.csp.assert_clean()
                report["cspViolations"] = session.csp.events
            except BaseException:
                if page:
                    try:
                        screenshot = options.output.with_name(options.output.stem + "-failure.png")
                        page.screenshot(path=str(screenshot), timeout=5000)
                        report["failureScreenshot"] = str(screenshot)
                    except Exception as error:
                        report["screenshotError"] = str(error)
                raise
    finally:
        stop_server(server)


def main():
    options = arguments()
    report = {"schemaVersion": 1, "suite": "SF-A25-Studio-browser", "passed": False,
              "implementationHead": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "selectedCases": options.cases,
              "checks": [], "workers": [], "pageErrors": [], "requestFailures": [], "dialogs": [],
              "unexpectedDialogs": [], "screenshots": [], "graphCommitCount": options.count,
              "mode": "built Studio via native HTTP; separate production source history performance fixture"}
    try:
        browser_run(options, report)
        report["passed"] = True
        report["fullUiScope"] = all(name in options.cases for name in CASES) and options.count == 10000
    except BaseException:
        report["failure"] = traceback.format_exc()
        traceback.print_exc()
    finally:
        report["completedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        options.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "checks": len(report["checks"]), "evidence": str(options.output)}), flush=True)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
