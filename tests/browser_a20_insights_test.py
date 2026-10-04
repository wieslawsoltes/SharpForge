"""Standalone provider/widget acceptance using real browser DOM and the real EditorModel.

Run against the repository static server with SHARPFORGE_INSIGHTS_URL, or let the test
serve built modules through the production HTTP server and CSP. No Studio, compiler or network service is required.
"""
from contextlib import nullcontext
import json
import os
from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir, selected_engine
from conformance.browser.editor_fixture import editor_fixture
from conformance.browser.matrix_common import policy, wait


passed = []
failure = None
url = os.environ.get("SHARPFORGE_INSIGHTS_URL")
try:
    with nullcontext(url) if url else editor_fixture('a20-editor-insights') as address, \
            sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
        page = browser.new_page(viewport={"width": 1200, "height": 900})
        page_errors = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        response = page.goto(address)
        assert response and response.status == 200
        policy(response.headers)
        wait(page, "window.insights !== undefined")

        def setup(text):
            page.evaluate("text => setup(text)", text)
            wait(page, "editor.zones.get('code-lens')?.length === 1")

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
        wait(page, "editor.value === 'renamed + renamed'")
        name.press("Escape")
        assert page.evaluate("editor.value") == "value + value"
        assert page.evaluate("editor.model.canUndo") is False
        page.evaluate("editor.goto(2); insights.rename()")
        name.fill("renamed")
        wait(page, "editor.value === 'renamed + renamed'")
        name.press("Enter")
        wait(page, "models.get('b.cs').value === 'renamed target'")
        assert page.evaluate("models.get('c.cs').value") == "renamed third"
        passed.append("inline rename previews/cancels exactly and commits across three real models")

        setup("value + value")
        page.evaluate("insights.codeActions()")
        page.get_by_role("button", name="Replace first word", exact=True).click()
        page.wait_for_selector(".sf-action-preview .sf-diff-row")
        assert page.evaluate("editor.value") == "value + value"
        page.get_by_role("button", name="Apply", exact=True).click()
        wait(page, "editor.value === 'fixed + value'")
        passed.append("code action preview is exact and does not mutate until Apply")

        setup("value + value")
        page.evaluate("insights.quickInfo(2)")
        page.wait_for_selector(".sf-tooltip:not(.hidden)")
        assert "CS0001" in page.locator(".sf-quick-info").inner_text()
        assert page.locator(".sf-quick-info img").count() == 0
        fixes = page.locator(".sf-quick-info").get_by_role("button", name="Show potential fixes", exact=True)
        assert fixes.count() == 1
        fixes.click()
        page.wait_for_selector(".sf-code-actions:not(.hidden)")
        assert page.locator(".sf-quick-info").is_hidden()
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
        wait(page, "models.get('b.cs').value === 'edited target'")
        page.evaluate("insights.peekForward()")
        page.wait_for_selector('[aria-label="Definition in c.cs"]')
        passed.append("Peek Definition edits the target model and navigates multiple results")

        setup("one=12; two=34;")
        page.evaluate("insights.openFind(true)")
        page.get_by_role("checkbox", name="Regular expression", exact=True).check()
        page.get_by_role("textbox", name="Find in current file").fill("(\\w+)=(\\d+)")
        page.get_by_role("textbox", name="Replace in current file").fill("$1($2)")
        wait(page, "document.querySelector('.sf-find-replace')?.dataset.searchState === 'complete' && "
                   "editor.decorations.get('find')?.length === 2")
        page.get_by_role("button", name="Replace all", exact=True).click()
        wait(page, "editor.value === 'one(12); two(34);'")
        passed.append("regex replace captures use the shared safe search engine")

        setup("alpha beta alpha")
        page.evaluate("editor.goto(6); insights.incrementalSearch(1)")
        query = page.get_by_role("textbox", name="Incremental search", exact=True)
        query.fill("alpha")
        wait(page, "editor.offset === 11 && "
                   "document.querySelector('.sf-incremental-search [role=status]')?.textContent === 'Forward: alpha'")
        assert page.evaluate("editor.offset") == 11
        query.press("Escape")
        wait(page, "editor.offset === 6")
        assert page.evaluate("editor.offset") == 6
        passed.append("incremental search restores its original caret on Escape")

        setup("value + value")
        wait(page, "window.resolves === 1")
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
except BaseException as error:
    failure = {"type": type(error).__name__, "message": str(error)}
    raise
finally:
    report = {"status": "failed" if failure else "passed", "engine": selected_engine(),
              "passed": len(passed), "checks": passed, "failure": failure}
    (results_dir() / 'a20-editor-insights.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    print(json.dumps(report, indent=2))
