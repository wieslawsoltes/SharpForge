"""The same create/edit/build/debug/design/export workflow on production HTTP and file builds."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_harness import wait_condition
from conformance.browser.launch import launch_browser, results_dir, selected_engine
from conformance.browser.workflow_loading import load_workflow, observe_offline_requests, workflow_mode
from conformance.browser.workflow_lazy_tools import activate_offline_panels, verify_offline_reopen


def require(value, message):
    if not value:
        raise AssertionError(message)


def create_and_edit(page, checks):
    page.evaluate("void sharpforge.openProjectWizard()")
    page.locator('[data-template="console"]').click()
    page.locator('#wizard-next').click()
    page.locator('#wizard-project-name').fill('')
    require(page.locator('#wizard-next').is_disabled() and page.locator('#wizard-errors').inner_text(),
            "Empty project name did not block creation with a diagnostic")
    page.locator('#wizard-project-name').fill('ShellWorkflow')
    require(page.locator('#wizard-errors').inner_text() == '', "Project name rejected")
    page.locator('#wizard-next').click()
    wait_condition(page, '''() => {
        const error = document.querySelector('#wizard-errors')?.textContent;
        if (error) throw new Error('Project creation failed: ' + error);
        return document.querySelector('#modal-backdrop').classList.contains('hidden');
    }''')
    uri = page.evaluate('sharpforge.getState().files.find(file => file.uri.endsWith("Program.cs")).uri')
    checks.append({"scenario": "create-console-project", "passed": True, "emptyNameRejected": True})

    source = "using System;\nclass Program {\n static void Main() {\n  int value = 41;\n  Console.WriteLine(value + 1);\n }\n}\n"
    page.evaluate('uri => sharpforge.openFile(uri)', uri)
    page.evaluate('source => sharpforge.workbenchShell.options.getEditor().setValue(source)', source)
    require(page.evaluate('uri => sharpforge.getState().files.find(file => file.uri === uri).text', uri) == source,
            "Editor change did not reach shared document service")
    require(page.evaluate('async () => (await sharpforge.build()).success'), "Console build failed")
    checks.append({"scenario": "edit-and-build-shared-document", "passed": True})
    return uri


def debug_source(page, uri, checks):
    page.evaluate('uri => sharpforge.setBreakpoints(uri, [{line: 5, enabled: true}])', uri)
    page.evaluate('sharpforge.debug({stopOnEntry: false})')
    wait_condition(page, 'sharpforge.getState().debug?.state === "paused"')
    require(page.evaluate('sharpforge.getState().debug.point?.line') == 5, "Debugger did not stop at the source breakpoint")
    page.evaluate('sharpforge.step("next")')
    if page.evaluate('sharpforge.getState().debug?.state') == 'paused':
        page.evaluate('sharpforge.execute("debug")')
    wait_condition(page, 'sharpforge.getState().debug?.state === "terminated"')
    observed = page.evaluate('''() => {
        const debug = sharpforge.getState().debug;
        return {output: debug.output, fault: debug.fault, profile: debug.profile, stats: debug.stats};
    }''')
    require(observed['output'].strip() == '42', "Runtime did not execute the edited source")
    require(not observed.get('fault'), "Runtime fault: " + repr(observed.get('fault')))
    statistics = observed.get('stats') or {}
    require(statistics.get('artifactFormat'), "Runtime did not report its executed artifact format")
    checks.append({"scenario": "breakpoint-step-continue", "passed": True,
                   "backend": statistics.get('profile') or observed.get('profile') or statistics['artifactFormat'],
                   "runtimeStatistics": statistics})
    page.evaluate('sharpforge.execute("stop")')


def design_and_export(page, checks):
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
    checks.append({"scenario": "export-project-and-design", "passed": True})
    return identity


def exercise(page, report):
    load_workflow(page, report['mode'], report['navigation'])
    wait_condition(page, "!!sharpforge.workbenchShell")
    page.evaluate("""async () => {
        for (let turn = 0; turn < 5; turn++) {
            for (const dialog of [...sharpforge.workbenchShell.dialogs.stack]) dialog.cancel();
            await Promise.resolve();
        }
    }""")
    offline = report['mode'] == 'file'
    if offline:
        report['lazyTools'] = activate_offline_panels(page)
    uri = create_and_edit(page, report['checks'])
    debug_source(page, uri, report['checks'])
    identity = design_and_export(page, report['checks'])
    if offline:
        report['lazyTools'].extend(verify_offline_reopen(page, identity))
        report['lazyMeasurement'] = {
            'controllerConstructionCount': 'unavailable: no public construction counter',
            'scriptEvaluationReduction': 'not measured by this correctness workflow'
        }
    require(not report['httpAttempts'], "Standalone attempted HTTP(S) requests: " + repr(report['httpAttempts']))
    require(not report['pageErrors'], "Browser errors: " + repr(report['pageErrors']))


def run(*, mode='http', suite=__file__):
    report = {'suite': Path(suite).stem, 'mode': mode, 'engine': selected_engine(), 'passed': False,
              'sourceSha': os.getenv('QUALIFICATION_SOURCE_SHA'), 'sourceTree': os.getenv('QUALIFICATION_SOURCE_TREE'),
              'checks': [], 'navigation': {}, 'httpAttempts': [], 'pageErrors': []}
    filename = 'vs-workflow-standalone-results.json' if mode == 'file' else 'vs-workflow-results.json'
    try:
        workflow_mode(mode)
        with sync_playwright() as playwright, launch_browser(playwright, suite, mode=mode) as browser:
            report['browser'] = browser.version
            page = browser.new_page(viewport={"width": 1440, "height": 1000}, offline=mode == 'file')
            page.set_default_timeout(20000)
            page.on('pageerror', lambda error: report['pageErrors'].append(str(error)))
            if mode == 'file':
                observe_offline_requests(page.context, report['httpAttempts'])
            exercise(page, report)
        require(not report['httpAttempts'], "Standalone attempted HTTP(S) requests: " + repr(report['httpAttempts']))
        require(not report['pageErrors'], "Browser errors: " + repr(report['pageErrors']))
        report['passed'] = True
    except BaseException as error:
        report['failure'] = {'type': type(error).__name__, 'message': str(error)}
        raise
    finally:
        (results_dir() / filename).write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
        print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    run()
