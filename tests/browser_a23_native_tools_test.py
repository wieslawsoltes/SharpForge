"""Actual Chromium UI + portable workers; native calls use an explicit transport fixture, not a native SDK oracle."""
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir
from browser_harness import load_application

ROOT = Path(__file__).resolve().parents[1]
RESULTS = results_dir()
checks = []


def truth(value, message='assertion failed'):
    if not value:
        raise AssertionError(message)


def checked(name, action):
    start = time.perf_counter()
    action()
    checks.append({'name': name, 'passed': True, 'milliseconds': (time.perf_counter() - start) * 1000})
    print('PASS', name, flush=True)


with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
    page = browser.new_page(viewport={'width': 1600, 'height': 1100})
    errors = []
    workers = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('worker', lambda worker: workers.append(worker.url))
    try:
        load_application(page)
        page.evaluate((ROOT / 'tests/support/a23-native-ui.js').read_text())
        fixture = page.locator('#native-ui-fixture')
        checked('Legacy MSBuild actions remain present and connection starts no target', lambda: truth(
            fixture.locator('[data-native-action]').count() == 11 and page.evaluate('__nativeUi.calls.length') == 0))

        def profiles():
            fixture.locator('[data-native-profiles-refresh]').click()
            page.wait_for_function('__nativeUi.ui.profiles.publish.length === 1 && !__nativeUi.ui.busy')
            fixture.locator('[data-native-publish-profile]').select_option('Folder')
            truth(page.evaluate('__nativeUi.calls.every(call => call.kind === "profiles")'))
            truth('publish' in fixture.locator('[data-native-publish-properties]').inner_text())
        checked('Untrusted profile discovery and selection are target-free visible controls', profiles)

        def context():
            fixture.locator('[data-native-setting="trusted"]').check()
            fixture.locator('[data-native-context-load]').click()
            page.wait_for_function('__nativeUi.ui.contexts.active && !__nativeUi.ui.busy')
            truth(page.evaluate('__nativeUi.state.nativeContextFiles.length') == 2)
            truth(page.evaluate('__nativeUi.state.files.find(file => file.generated).readOnly'))
            fixture.locator('[data-native-context-select]').select_option(page.evaluate('__nativeUi.contexts[1].id'))
            page.wait_for_function('__nativeUi.state.nativeProjectContext.targetFramework === "net10.0" && !__nativeUi.ui.busy')
            truth('net10.0' in fixture.locator('[data-native-context-status]').inner_text())
            truth(page.evaluate('__nativeUi.state.nativeCompilationOptions.defines.includes("NET10_0")'))
        checked('Context selector activates exact files, options and readonly generated sources', context)

        def launch_profile():
            fixture.locator('[data-native-project-run]').click()
            page.wait_for_function('__nativeUi.calls.some(call => call.kind === "run") && !__nativeUi.ui.busy')
            request = page.evaluate('__nativeUi.calls.find(call => call.kind === "run").request')
            truth(request['arguments'] == ['first', 'two words'])
            truth(request['environment']['MODE'] == 'browser-check')
            truth(request['environment']['ASPNETCORE_URLS'] == 'http://localhost:8181')
            truth(request['workingDirectory'] == 'work' and request['framework'] == 'net10.0')
        checked('Launch button sends selected args, environment, directory and framework', launch_profile)

        def publish_profile():
            fixture.locator('[data-native-profile-publish]').click()
            page.wait_for_function('__nativeUi.calls.some(call => call.kind === "publish") && !__nativeUi.ui.busy')
            truth(page.evaluate('__nativeUi.calls.find(call => call.kind === "publish").request.profile') == 'Folder')
        checked('Publish button explicitly executes selected profile through job lifecycle', publish_profile)

        fixture.locator('[data-native-tests-open]').click()
        page.wait_for_selector('#native-ui-fixture .test-explorer')

        for backend in ['source', 'cil']:
            def portable_run(backend=backend):
                fixture.locator('[data-test-provider]').select_option('portable-' + backend)
                fixture.locator('[data-test-discover]').click()
                page.wait_for_function('__nativeUi.ui.tests.tests.length === 3 && !__nativeUi.ui.tests.busy', timeout=60000)
                fixture.locator('[data-test-run]').click()
                page.wait_for_function('__nativeUi.ui.tests.results.size === 3 && !__nativeUi.ui.tests.busy', timeout=60000)
                outcomes = page.evaluate('[...__nativeUi.ui.tests.results.values()].map(result => result.outcome).sort()')
                truth(outcomes == ['failed', 'passed', 'skipped'], str(outcomes))
                truth('1 failed' in fixture.locator('[data-test-status]').inner_text())
            checked('Real portable ' + backend + ' worker reports pass/fail/skip', portable_run)

        def selected_test():
            fixture.locator('[data-test-select-none]').click()
            good = page.evaluate('__nativeUi.ui.tests.tests.find(test => test.fqn.endsWith(".Good")).id')
            fixture.locator('[data-test-check="' + good + '"]').check()
            fixture.locator('[data-test-run]').click()
            page.wait_for_function('__nativeUi.ui.tests.results.size === 1 && !__nativeUi.ui.tests.busy', timeout=60000)
            truth(page.evaluate('[...__nativeUi.ui.tests.results.values()][0].outcome') == 'passed')
            fixture.locator('[data-test-detail="' + good + '"]').click()
            fixture.locator('[data-test-source]').click()
            page.wait_for_function('__nativeUi.opened.length > 0')
            truth(page.evaluate('__nativeUi.opened.at(-1).path') == 'App/Tests.cs')
        checked('Selected portable test runs in a fresh session and navigates to source', selected_test)

        def native_results():
            fixture.locator('[data-test-provider]').select_option('native-vstest')
            fixture.locator('[data-test-discover]').click()
            page.wait_for_function('__nativeUi.ui.tests.tests.length === 3 && !__nativeUi.ui.tests.busy', timeout=60000)
            fixture.locator('[data-test-run]').click()
            page.wait_for_function('__nativeUi.ui.tests.result && !__nativeUi.ui.tests.busy')
            truth('1 / 2 covered lines' in fixture.locator('[data-test-coverage]').inner_text())
            fixture.locator('[data-test-coverage-file="0"] summary').click()
            truth('1 / 2' in fixture.locator('[data-test-coverage-file="0"]').inner_text())
            fixture.locator('[data-test-artifact="0"]').click()
            page.wait_for_function('__nativeUi.downloaded.length === 1')
            truth(page.evaluate('__nativeUi.downloaded[0].size') == 3)
        checked('Native transport results expose source, artifacts and line/branch coverage', native_results)

        def cancel_native():
            page.evaluate('__nativeUi.setSlow(true)')
            fixture.locator('[data-test-run]').click()
            page.wait_for_function('__nativeUi.ui.tests.busy && __nativeUi.ui.tests.session?.debuggerHandoff')
            truth('PID 42' in fixture.locator('[data-test-debugger]').inner_text())
            fixture.locator('[data-test-cancel]').click()
            page.wait_for_function('!__nativeUi.ui.tests.busy')
            truth(page.evaluate('[...__nativeUi.ui.tests.results.values()].every(result => result.outcome === "not-run")'))
        checked('Native live PID handoff and cancellation leave remaining tests not-run', cancel_native)
        checked('Portable tests created an actual separate worker', lambda: truth(any('test.worker.js' in url for url in workers)))
        checked('No application or fixture JavaScript errors', lambda: truth(not errors and not page.evaluate('__nativeUi.errors'), str(errors)))
        page.screenshot(path=str(RESULTS / 'screenshots/a23-native-tools.png'))
        page.evaluate('__nativeUi.close()')
    finally:
        (RESULTS / 'browser-a23-native-tools-results.json').write_text(json.dumps({
            'passed': len(checks) == 12 and not errors, 'checks': checks, 'errors': errors,
            'mode': 'Actual Chromium, production CSP/module UI and real portable source/CIL worker; native transport fixture only'
        }, indent=2) + '\n')
