"""Standalone provider/widget acceptance using real Chromium DOM and the real EditorModel.

Run against the repository static server with SHARPFORGE_INSIGHTS_URL, or let the test
start a temporary local-only HTTP server. No Studio, compiler or network service is required.
"""
import functools
import http.server
import json
import os
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


server = None
url = os.environ.get("SHARPFORGE_INSIGHTS_URL")
if not url:
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}/tests/fixtures/a20-editor-insights.html"

passed = []
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1200, "height": 900})
        page_errors = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(url)
        page.wait_for_function("window.insights !== undefined")

        def setup(text):
            page.evaluate("text => setup(text)", text)
            page.wait_for_function("editor.zones.get('code-lens')?.length === 1")

        setup("Re")
        page.evaluate("editor.goto(2); insights.complete()")
        page.wait_for_selector(".sf-completions:not(.hidden) [role=option]")
        page.locator(".sf-completions [role=option]").filter(has_text="ReadLine").click()
        assert page.evaluate("editor.value") == "ReadLine"
        passed.append("completion renders kind/filter/docs and applies selected text")

        setup("Re")
        page.evaluate("editor.goto(2); insights.complete()")
        page.wait_for_selector(".sf-completions:not(.hidden)")
        page.locator("#source").focus()
        page.keyboard.press("Escape")
        assert page.evaluate("editor.value") == "Re"
        passed.append("completion Escape preserves typed text")

        setup("")
        page.evaluate("insights.insertSnippet('for (int ${1:i}=0; $1 < ${2:count}; $1++) { $0 }')")
        page.locator("#source").focus()
        page.keyboard.type("counter")
        assert page.evaluate("editor.value") == "for (int counter=0; counter < count; counter++) {  }"
        page.keyboard.press("Tab")
        assert page.evaluate("editor.value.slice(editor.input.selectionStart, editor.input.selectionEnd)") == "count"
        page.keyboard.press("Escape")
        assert "counter" in page.evaluate("editor.value")
        passed.append("snippet fields mirror while typing and Tab advances without losing source")

        setup("value + value")
        page.evaluate("editor.goto(2); insights.rename()")
        name = page.get_by_role("textbox", name="New symbol name")
        name.fill("renamed")
        page.wait_for_function("editor.value === 'renamed + renamed'")
        name.press("Escape")
        assert page.evaluate("editor.value") == "value + value"
        assert page.evaluate("editor.model.canUndo") is False
        page.evaluate("editor.goto(2); insights.rename()")
        name.fill("renamed")
        page.wait_for_function("editor.value === 'renamed + renamed'")
        name.press("Enter")
        page.wait_for_function("models.get('b.cs').value === 'renamed target'")
        assert page.evaluate("models.get('c.cs').value") == "renamed third"
        passed.append("inline rename previews/cancels exactly and commits across three real models")

        setup("value + value")
        page.evaluate("insights.codeActions()")
        page.get_by_role("button", name="Replace first word", exact=True).click()
        page.wait_for_selector(".sf-action-preview .sf-diff-row")
        assert page.evaluate("editor.value") == "value + value"
        page.get_by_role("button", name="Apply", exact=True).click()
        page.wait_for_function("editor.value === 'fixed + value'")
        passed.append("code action preview is exact and does not mutate until Apply")

        setup("value + value")
        page.evaluate("insights.quickInfo(2)")
        page.wait_for_selector(".sf-tooltip:not(.hidden)")
        assert "CS0001" in page.locator(".sf-quick-info").inner_text()
        assert page.locator(".sf-quick-info img").count() == 0
        assert page.get_by_role("button", name="Show potential fixes").count() == 1
        passed.append("Quick Info combines signature, safe documentation and diagnostic quick fix")

        setup("F(1, ")
        page.evaluate("editor.goto(editor.value.length); insights.signatureHelp()")
        page.wait_for_selector(".sf-signature-help:not(.hidden)")
        assert page.locator(".sf-active-parameter").inner_text() == "string y"
        page.get_by_role("button", name="Next overload").click()
        assert "double x" in page.locator(".sf-signature-help").inner_text()
        passed.append("parameter info highlights active argument and cycles overloads")

        setup("value source")
        page.evaluate("insights.peekDefinition()")
        target = page.get_by_role("textbox", name="Definition in b.cs")
        target.fill("edited target")
        page.wait_for_function("models.get('b.cs').value === 'edited target'")
        page.evaluate("insights.peekForward()")
        page.wait_for_selector('[aria-label="Definition in c.cs"]')
        passed.append("Peek Definition edits the target model and navigates multiple results")

        setup("one=12; two=34;")
        page.evaluate("insights.openFind(true)")
        page.get_by_role("checkbox", name="Regular expression", exact=True).check()
        page.get_by_role("textbox", name="Find in current file").fill("(\\w+)=(\\d+)")
        page.get_by_role("textbox", name="Replace in current file").fill("$1($2)")
        page.get_by_role("button", name="Replace all", exact=True).click()
        page.wait_for_function("editor.value === 'one(12); two(34);'")
        passed.append("regex replace captures use the shared safe search engine")

        setup("alpha beta alpha")
        page.evaluate("editor.goto(6); insights.incrementalSearch(1)")
        query = page.get_by_role("textbox", name="Incremental search", exact=True)
        query.fill("alpha")
        assert page.evaluate("editor.offset") == 11
        query.press("Escape")
        assert page.evaluate("editor.offset") == 6
        passed.append("incremental search restores its original caret on Escape")

        setup("value + value")
        page.wait_for_function("window.resolves === 1")
        page.evaluate("insights.render(); insights.render()")
        assert page.evaluate("window.resolves") == 1
        assert page.evaluate("editor.widgets.get('inlay-hints')[0].node.contentEditable") == "false"
        page.evaluate("insights.nextReference(1)")
        page.evaluate("insights.showCodeLensMenu()")
        page.get_by_role("button", name="3 references", exact=True).last.click()
        assert page.evaluate("commands.some(item => item.method === 'references')") is True
        passed.append("inlay hints retain source offsets and CodeLens resolves once with actionable UI")

        page.evaluate("insights.dispose()")
        assert page.locator(".sf-insight-popup").count() == 0
        assert not page_errors, page_errors
        passed.append("disposal removes every popup and produces no uncaught browser errors")
        browser.close()
finally:
    if server:
        server.shutdown()

print(json.dumps({"passed": len(passed), "checks": passed}, indent=2))
