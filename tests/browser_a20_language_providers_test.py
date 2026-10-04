"""Real CodeEditor + real bound providers. Run after the complete scope's single production build."""
import json
from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir, selected_engine
from conformance.browser.editor_fixture import editor_fixture
from conformance.browser.matrix_common import policy, wait

passed = []
failure = None
try:
    with editor_fixture('a20-language-insights') as address, sync_playwright() as playwright, \
            launch_browser(playwright, __file__) as browser:
        page = browser.new_page(viewport={"width": 1200, "height": 800})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        response = page.goto(address)
        assert response and response.status == 200
        policy(response.headers)
        wait(page, "typeof window.setupLanguageEditor === 'function' && window.editor?.model !== undefined")

        page.evaluate("editor.goto(editor.value.indexOf('first')); editor.insights.codeActions()")
        page.get_by_role('button', name="Use explicit type 'int'", exact=False).click()
        page.get_by_role('button', name='Fix all in document', exact=True).click()
        wait(page, "document.querySelector('.sf-code-actions').textContent.includes('Fix 2 occurrences')")
        assert page.evaluate("editor.value.includes('var first=1;var second=2;')")
        page.get_by_role('button', name='Apply', exact=True).click()
        wait(page, "editor.value.includes('int first=1;int second=2;')")
        passed.append('selected Fix All family previews the complete batch and applies exact source edits')

        original = '//😀 Widget\r\nclass Widget { Widget Get()=>new Widget(); string name="Widget"; }'
        page.evaluate('text => setupLanguageEditor(text)', original)
        page.evaluate("editor.goto(editor.value.indexOf('class Widget') + 6); editor.insights.rename()")
        field = page.get_by_role('textbox', name='New symbol name', exact=True)
        field.fill('Gadget')
        wait(page, "editor.value.includes('class Gadget') && editor.value.includes('new Gadget()')")
        page.get_by_role('checkbox', name='Include comments', exact=True).check()
        page.get_by_role('checkbox', name='Include strings', exact=True).check()
        wait(page, "editor.value.includes('//😀 Gadget') && editor.value.includes('name=\"Gadget\"')")
        field.press('Escape')
        assert page.evaluate('editor.value') == original
        assert page.evaluate('editor.model.version') == 1
        assert not page.evaluate('editor.model.canUndo')
        passed.append('bound type/comment/string live preview cancels to exact UTF-16/CRLF source and undo state')

        hints = 'class Widget { static int F(int amount)=>amount; static int M(){var x=F(7);return x;} }'
        page.evaluate('text => setupLanguageEditor(text)', hints)
        wait(page, "Array.from(document.querySelectorAll('.sf-inlay-hint')).some(node => node.textContent === 'amount:')")
        page.evaluate("editor.goto(editor.value.indexOf('7')); window.beforeHintOffset = editor.offset")
        page.evaluate("services.invalidate('inlayHints', {uri:'Widget.cs'}); services.invalidate('codeLens', {uri:'Widget.cs'})")
        wait(page, "Array.from(document.querySelectorAll('.sf-inlay-hint')).some(node => node.textContent === 'amount:')")
        assert page.evaluate('editor.value') == hints
        assert page.evaluate('editor.offset === beforeHintOffset')
        assert page.evaluate("Array.from(document.querySelectorAll('.sf-inlay-hint')).every(node => node.contentEditable === 'false')")
        passed.append('parameter hints and provider invalidation preserve real source offsets and caret')
        assert not errors, errors
        assert not page.evaluate('window.errors'), page.evaluate('window.errors')
except BaseException as error:
    failure = {"type": type(error).__name__, "message": str(error)}
    raise
finally:
    report = {"status": "failed" if failure else "passed", "engine": selected_engine(),
              "passed": len(passed), "checks": passed, "failure": failure}
    (results_dir() / 'a20-language-providers.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    print(json.dumps(report, indent=2))
