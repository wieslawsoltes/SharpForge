"""Actual CodeEditor DOM acceptance. Synthetic composition is not native IME certification.

Run with the supported Playwright engine. The fixture serves built repository modules and the production CSP,
uses the real persistent model, and fails rather than silently skipping a missing browser.
"""
import json
from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir, selected_engine
from conformance.browser.editor_fixture import editor_fixture
from conformance.browser.matrix_common import policy, wait


passed = []
failure = None
try:
    with editor_fixture('a20-editor-view') as address, sync_playwright() as playwright, \
            launch_browser(playwright, __file__) as browser:
        page = browser.new_page(viewport={"width": 1200, "height": 900})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        response = page.goto(address)
        assert response and response.status == 200
        policy(response.headers)
        wait(page, "window.editor !== undefined")

        def setup(text, options=None):
            page.evaluate("args => setupView(args)", {"text": text, "options": options or {}})
            page.evaluate("viewSettled()")

        setup("a😀b\n中\tx")
        page.evaluate("editor.goto(1)")
        page.keyboard.press("Delete")
        assert page.evaluate("editor.value") == "ab\n中\tx"
        page.keyboard.type("Z")
        assert page.evaluate("editor.value") == "aZb\n中\tx"
        page.keyboard.press("Control+z")
        assert page.evaluate("editor.value") == "ab\n中\tx"
        passed.append("native keydown/beforeinput edits the authoritative model and preserves graphemes")

        page.evaluate("setupView({text:'line\\n'.repeat(500000),options:{largeFileThreshold:2000000}})")
        page.evaluate("editor.gotoLine(499900); viewSettled()")
        assert page.evaluate("editor.view.lines.visible.size") < 160
        assert page.evaluate("nativeContextLength()") <= 2048
        assert page.evaluate("editor.highlightMetrics.firstLine") > 499800
        assert page.evaluate("sourceRows().every(row => row.text === editor.model.getText(row.start, row.start + row.text.length))")
        passed.append("500000 lines render bounded source-faithful rows with a bounded native input")

        setup("zero\n" + "abc 中😀 word ".__mul__(80) + "\nlast", {"wordWrap": True})
        page.evaluate("editor.gotoLine(2); viewSettled()")
        assert page.evaluate("editor.view.layout.line(1).segments.length") > 1
        page.evaluate("editor.runCommand('Edit.ViewWhiteSpace'); viewSettled()")
        assert page.locator(".sf-whitespace").count() > 0
        assert page.evaluate("editor.value.includes('中😀')")
        page.evaluate("editor.setZoom(175); viewSettled()")
        assert page.evaluate("editor.options.zoom") == 175
        passed.append("wrap, whitespace and zoom retain source while sharing layout metrics")

        setup("class C {\n void M() {\n  work();\n }\n}\nnext")
        page.evaluate("editor.folding.setRanges([{startLine:0,endLine:4},{startLine:1,endLine:3}],6)")
        page.evaluate("editor.runCommand('Edit.CollapseAllRegions'); viewSettled()")
        assert page.evaluate("editor.folding.hidden(2)")
        page.evaluate("editor.setBreakpoints([{line:3,enabled:true}]); editor.gotoLine(3); viewSettled()")
        assert not page.evaluate("editor.folding.hidden(2)")
        page.evaluate("editor.toggleBookmark(2); editor.insertText('X')")
        assert page.evaluate("editor.bookmarks.has(2)")
        assert page.evaluate("editor.changeTracking.stateAt(2)") == "unsaved"
        passed.append("outlining hides logical ranges, navigation reveals them and margins track edits")

        setup("one\ntwo\nthree")
        page.evaluate("editor.goto(1); editor.toggleSplit(); window.second = editor.splitController.second; second.goto(6)")
        page.evaluate("second.insertText('!'); viewSettled()")
        assert page.evaluate("editor.model === second.model")
        assert page.evaluate("editor.value") == "one\ntw!o\nthree"
        assert page.evaluate("editor.caretOffset") == 1
        assert page.evaluate("published.length") == 1
        page.evaluate("second.undo()")
        assert page.evaluate("editor.value") == "one\ntwo\nthree"
        page.evaluate("editor.toggleSplit()")
        assert page.locator(".sf-editor-split-host").count() == 0
        passed.append("split views share undo/text, preserve independent carets and publish each edit once")

        setup("before after")
        page.evaluate("editor.goto(7)")
        page.evaluate("""() => {
          const send = (type, data) => editor.input.dispatchEvent(new CompositionEvent(type, {data, bubbles:true}));
          send('compositionstart',''); send('compositionupdate','日本');
          window.duringComposition = editor.value;
          send('compositionend','日本');
        }""")
        assert page.evaluate("duringComposition") == "before after"
        assert page.evaluate("editor.value") == "before 日本after"
        assert page.evaluate("editor.model.undoStack.depth") == 1
        passed.append("synthetic DOM composition stays transient and commits once")

        setup("English שלום العربية end")
        page.evaluate("editor.goto(10); viewSettled()")
        assert page.evaluate("Number.isFinite(editor.view.coordsAt(10).left)")
        assert page.evaluate("editor.view.bidi.rectangles(editor.view.lines.elementFor(0),8,12).length") > 0
        page.keyboard.press("ArrowLeft")
        assert page.evaluate("editor.caretOffset") != 10
        passed.append("native DOM bidi geometry supplies visual selections and caret movement")

        setup("broken symbol")
        page.evaluate("editor.setDiagnostics([{range:{start:{line:0,character:0},end:{line:0,character:6}},severity:1,message:'Problem'}])")
        page.evaluate("editor.runCommand('Edit.NextError'); viewSettled()")
        assert "Problem" in page.evaluate("editor.accessibility.status.textContent")
        assert page.locator(".sf-input").get_attribute("aria-multiline") == "true"
        page.emulate_media(forced_colors="active", reduced_motion="reduce")
        page.evaluate("viewSettled()")
        assert page.locator(".sf-caret").count() >= 1
        page.evaluate("editor.setReadOnly(true)")
        page.keyboard.type("blocked")
        assert page.evaluate("editor.value") == "broken symbol"
        assert page.evaluate("editor.model.readOnly")
        passed.append("ARIA diagnostics, forced colors, reduced motion and read-only state are wired")

        page.evaluate("editor.dispose()")
        assert page.locator(".sf-viewport, .sf-input, .sf-insight-popup").count() == 0
        assert not errors, errors
        passed.append("complete disposal removes view/input/widgets with no uncaught browser errors")
except BaseException as error:
    failure = {"type": type(error).__name__, "message": str(error)}
    raise
finally:
    report = {"status": "failed" if failure else "passed", "engine": selected_engine(),
              "passed": len(passed), "checks": passed, "failure": failure,
              "nativeImeCertified": False, "screenReaderCertified": False}
    (results_dir() / 'a20-editor-view.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    print(json.dumps(report, indent=2))
