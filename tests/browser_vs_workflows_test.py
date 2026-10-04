"""Core create/edit/build/breakpoint/design/export workflows through production Studio services."""
import json
from playwright.sync_api import sync_playwright
from browser_harness import load_application, wait_condition
from conformance.browser.launch import launch_browser, results_dir


def require(value, message):
    if not value:
        raise AssertionError(message)


def run():
    checks = []
    with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_default_timeout(20000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        load_application(page)
        wait_condition(page, "!!sharpforge.workbenchShell")
        page.evaluate("""async () => {
          for (let turn = 0; turn < 5; turn++) {
            for (const dialog of [...sharpforge.workbenchShell.dialogs.stack]) dialog.cancel();
            await Promise.resolve();
          }
        }""")

        page.evaluate("void sharpforge.openProjectWizard()")
        page.locator('[data-template="console"]').click()
        page.locator('#wizard-next').click()
        page.locator('#wizard-project-name').fill('ShellWorkflow')
        require(page.locator('#wizard-errors').inner_text() == '', "Project name rejected")
        page.locator('#wizard-next').click()
        wait_condition(page, 'document.querySelector("#modal-backdrop").classList.contains("hidden")')
        uri = page.evaluate('sharpforge.getState().files.find(file => file.uri.endsWith("Program.cs")).uri')
        checks.append({"scenario": "create-console-project", "passed": True})

        source = "using System;\nclass Program {\n static void Main() {\n  int value = 41;\n  Console.WriteLine(value + 1);\n }\n}\n"
        page.evaluate('uri => sharpforge.openFile(uri)', uri)
        page.evaluate('source => sharpforge.workbenchShell.options.getEditor().setValue(source)', source)
        require(page.evaluate('uri => sharpforge.getState().files.find(file => file.uri === uri).text', uri) == source,
                "Editor change did not reach shared document service")
        require(page.evaluate('async () => (await sharpforge.build()).success'), "Console build failed")
        checks.append({"scenario": "edit-and-build-shared-document", "passed": True})

        page.evaluate('uri => sharpforge.setBreakpoints(uri, [{line: 5, enabled: true}])', uri)
        page.evaluate('sharpforge.debug({stopOnEntry: false})')
        wait_condition(page, 'sharpforge.getState().debug?.state === "paused"')
        require(page.evaluate('sharpforge.getState().debug.point?.line') == 5, "Debugger did not stop at the source breakpoint")
        page.evaluate('sharpforge.step("next")')
        if page.evaluate('sharpforge.getState().debug?.state') == 'paused':
            page.evaluate('sharpforge.execute("debug")')
        wait_condition(page, 'sharpforge.getState().debug?.state === "terminated"')
        require(page.evaluate('sharpforge.getState().debug.output.trim()') == '42', "Runtime did not execute the edited source")
        page.evaluate('sharpforge.execute("stop")')
        checks.append({"scenario": "breakpoint-step-continue", "passed": True, "backend": "source VM"})

        page.evaluate('sharpforge.designer.open()')
        page.evaluate('sharpforge.designer.action("new")')
        identity = page.evaluate('sharpforge.designer.add("Button", "canvas")')
        page.evaluate('id => sharpforge.designer.set("Content", "Shell workflow", [id])', identity)
        page.evaluate('sharpforge.designer.action("save")')
        value = page.evaluate('id => sharpforge.designer.get().document.nodes.find(node => node.id === id).properties.Content', identity)
        require(value == 'Shell workflow', "Designer property did not update its document")
        page.evaluate('sharpforge.designer.action("undo")')
        page.evaluate('sharpforge.designer.action("redo")')
        page.evaluate('sharpforge.designer.action("save")')
        checks.append({"scenario": "designer-edit-undo-redo-save", "passed": True})

        exported = page.evaluate("""async () => {
          const bytes = await sharpforge.exportWorkspaceZip();
          const records = sharpforge.getWorkspace().records;
          return {bytes: bytes.length, source: records.some(record => record.text?.includes('Console.WriteLine(value + 1)')),
            design: records.some(record => record.path.endsWith('.sfdesign.json'))};
        }""")
        require(exported['bytes'] > 1000 and exported['source'] and exported['design'], "Archive omitted source or designer documents")
        require(not errors, "Browser errors: " + repr(errors))
        checks.append({"scenario": "export-project-and-design", "passed": True})
        (results_dir() / 'vs-workflow-results.json').write_text(json.dumps({"checks": checks}, indent=2), encoding='utf8')
        print(json.dumps(checks, indent=2))


if __name__ == '__main__':
    run()
