"""Actual Code Definition caret latency and 10,000-line overview canvas budgets; serial, raw and failure-retaining."""
import hashlib
import json
import math
import os
import platform
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_harness import load_application
from conformance.browser.launch import launch_browser, results_dir
from conformance.browser.editor_fixture import editor_fixture
from conformance.browser.matrix_common import policy, wait

ROOT = Path(__file__).resolve().parents[1]
VIEWPORT = {'width': 1440, 'height': 1000}
SOURCE_PATHS = [
    'apps/studio/workbench/tools/code-definition.js', 'apps/studio/workbench/tools/code-definition-provider.js',
    'apps/studio/workbench/metadata/catalog.js', 'packages/editor/src/view/overview-ruler.js',
    'packages/editor/src/view/virtual-view.js', 'apps/studio/workbench/shell.js'
]
HARNESS_PATHS = [
    'tests/browser_editor_budgets_test.py', 'tests/editor-budget-trace.mjs',
    'tests/fixtures/code-definition-budget.js', 'tests/fixtures/overview-ruler-budget.js',
    'tests/fixtures/a20-editor-view-fixture.js', 'tests/fixtures/a20-editor-view.html',
    'tests/conformance/browser/launch.py', 'tests/conformance/browser/editor_fixture.py', 'tests/browser_harness.py'
]


def digest(value):
    return hashlib.sha256(value).hexdigest()


def fixture():
    alpha = 'class Alpha { public static int RunAlpha(int value) { return value + 101; } }'
    beta = 'class Beta { public static int RunBeta(int value) { return value + 202; } }'
    calls = ('using System;\nclass Calls { static void Main() {\n  \n'
             '  int first = Alpha.RunAlpha(1);\n  int second = Beta.RunBeta(2);\n  Console.WriteLine(first + second);\n} }')
    records = [{'path': 'Budget.csproj', 'text': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
                '<OutputType>Exe</OutputType></PropertyGroup></Project>'},
               {'path': 'Alpha.cs', 'text': alpha}, {'path': 'Beta.cs', 'text': beta}, {'path': 'Calls.cs', 'text': calls}]
    targets = [{'id': 'source-alpha', 'kind': 'source', 'uri': 'Alpha.cs', 'text': alpha, 'name': 'RunAlpha',
                'offset': calls.index('RunAlpha') + 2},
               {'id': 'source-beta', 'kind': 'source', 'uri': 'Beta.cs', 'text': beta, 'name': 'RunBeta',
                'offset': calls.index('RunBeta') + 2},
               {'id': 'framework-metadata', 'kind': 'metadata', 'offset': calls.index('WriteLine') + 2}]
    value = {'id': 'editor-ui-budgets-v1', 'records': records, 'targets': targets, 'callerUri': 'Calls.cs',
             'neutralOffset': calls.index('\n  \n') + 2, 'lineCount': 10000,
             'counts': {'definition': {'first': 1, 'warmup': 2, 'measured': 15},
                        'overview': {'first': 1, 'warmup': 3, 'measured': 31}}}
    value['sha256'] = digest(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())
    return value


def provenance():
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    return {'revision': revision, 'sourceFiles': {path: digest((ROOT / path).read_bytes()) for path in SOURCE_PATHS},
            'harnessFiles': {path: digest((ROOT / path).read_bytes()) for path in HARNESS_PATHS}}


def environment(page, browser, serving_mode):
    observed = page.evaluate('''() => ({deviceScaleFactor: devicePixelRatio, hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory ?? null, userAgent: navigator.userAgent, visibility: document.visibilityState,
      viewport: {width: innerWidth, height: innerHeight}, crossOriginIsolated, documentPath: location.pathname})''')
    return {**observed, 'engine': browser.engine, 'browserVersion': browser.version, 'headless': True,
            'operatingSystem': platform.system() + ' ' + platform.release(), 'architecture': platform.machine(),
            'processor': platform.processor(), 'servingMode': serving_mode, 'clock': 'performance.now',
            'physicalFrameRateCertified': False, 'safariCertified': False}


def built_assets(page, paths):
    # Verify the bytes actually served, including the bundled compiler worker, against this completed build.
    hashes = page.evaluate('''async paths => {
      const entries = [];
      for (const path of paths) {
        const response = await fetch(new URL(path, location.href));
        if (!response.ok) throw new Error('Missing measurement asset: ' + path);
        const hash = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
        entries.push([path, [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('')]);
      }
      return Object.fromEntries(entries);
    }''', paths)
    for path, actual in hashes.items():
        expected = digest((ROOT / 'dist' / path).read_bytes())
        if actual != expected:
            raise AssertionError('Served artifact differs from this build: ' + path)
    return hashes


def install_helper(page, name):
    page.evaluate((ROOT / 'tests/fixtures' / (name + '.js')).read_text(encoding='utf8'))


def summarize(samples):
    rows = []
    for case, phase in sorted({(sample['case'], sample['phase']) for sample in samples}):
        values = sorted(sample['durationMs'] for sample in samples if sample['case'] == case and sample['phase'] == phase)
        rows.append({'case': case, 'phase': phase, 'count': len(values), 'max': values[-1],
                     **{key: values[math.ceil(len(values) * fraction) - 1]
                        for key, fraction in [('p50', .5), ('p95', .95), ('p99', .99)]}})
    return rows


def save(trace, output):
    for stage in trace['stages'].values():
        stage['summary'] = summarize(stage['samples'])
    output.write_text(json.dumps(trace, indent=2, allow_nan=False) + '\n', encoding='utf8')


def new_page(browser, trace, name):
    page = browser.new_page(viewport=VIEWPORT, device_scale_factor=1)
    page.on('pageerror', lambda error: trace['browserErrors'].append({'stage': name, 'message': str(error)}))
    return page


def capture_definition(browser, trace, output):
    stage = trace['stages']['definition']
    page = new_page(browser, trace, 'definition')
    navigations = []
    page.on('response', lambda response: navigations.append(response.headers)
            if response.request.is_navigation_request() and response.frame == page.main_frame else None)
    load_application(page)
    wait(page, '!!window.sharpforge?.workbenchShell')
    stage['policy'] = policy(navigations[-1] if navigations else {})
    stage['environment'] = environment(page, browser, 'production-studio-http')
    stage['assets'] = built_assets(page, ['workbench/tools/code-definition.js',
        'workbench/tools/code-definition-provider.js', 'workbench/metadata/catalog.js', 'compiler.worker.js', 'studio.css'])
    install_helper(page, 'code-definition-budget')
    stage['setup'] = page.evaluate('config => codeDefinitionBudget.setup(config)', trace['fixture'])
    for phase, count in trace['fixture']['counts']['definition'].items():
        for index in range(count):
            for target in trace['fixture']['targets']:
                sample = page.evaluate('config => codeDefinitionBudget.sample(config)',
                                       {'target': target, 'phase': phase, 'index': index})
                stage['samples'].append(sample)
                save(trace, output)
                if not sample['correct']:
                    raise AssertionError('Code Definition correctness/focus failed: ' + repr(sample))
    stage['boundaries'] = page.evaluate('targets => codeDefinitionBudget.boundaries(targets)', trace['fixture']['targets'])
    stage['status'] = 'captured'


def capture_overview(browser, trace, output):
    stage = trace['stages']['overview']
    with editor_fixture('a20-editor-view') as address:
        page = new_page(browser, trace, 'overview')
        response = page.goto(address)
        if response is None or response.status != 200:
            raise AssertionError('Built editor fixture did not return HTTP 200')
        stage['policy'] = policy(response.headers)
        wait(page, "typeof window.setupView === 'function' && !!window.editor?.model")
        stage['environment'] = environment(page, browser, 'built-editor-fixture-http')
        stage['assets'] = built_assets(page, ['packages/editor/src/view/overview-ruler.js',
            'packages/editor/src/view/virtual-view.js', 'packages/editor/src/view/virtual.css'])
        install_helper(page, 'overview-ruler-budget')
        stage['setup'] = page.evaluate('overviewBudget.setup()')
        stage['pointers'] = []
        for mode in ['narrow', 'medium', 'wide']:
            page.evaluate('mode => overviewBudget.mode(mode)', mode)
            for phase, count in trace['fixture']['counts']['overview'].items():
                for index in range(count):
                    sample = page.evaluate('config => overviewBudget.sample(config)', {'mode': mode, 'phase': phase, 'index': index})
                    stage['samples'].append(sample)
                    save(trace, output)
                    if not sample['correct']:
                        raise AssertionError('Overview pixels/source geometry failed: ' + repr(sample))
            target = page.evaluate('overviewBudget.pointerTarget()')
            page.mouse.move(target['x'], target['y'])
            page.mouse.click(target['x'], target['y'])
            result = page.evaluate('target => overviewBudget.pointerResult(target)', target)
            stage['pointers'].append({'case': mode, **result})
        stage['status'] = 'captured'


def assess(output):
    result = subprocess.run([os.getenv('NODE', 'node'), 'tests/editor-budget-trace.mjs', str(output)],
                            cwd=ROOT, capture_output=True, text=True, encoding='utf8', check=False)
    if not result.stdout.strip():
        raise RuntimeError('Budget assessment produced no result: ' + result.stderr)
    return result.returncode, json.loads(result.stdout)


class StageBudgetFailure(AssertionError):
    """Retain launcher diagnostics without discarding an otherwise complete raw capture."""


def capture_stage(playwright, trace, output, name, capture):
    stage = trace['stages'][name]
    suite = Path(__file__).with_name(Path(__file__).stem + '_' + name + '.py')
    stage.update(status='running', session=suite.stem, cspViolations=[])
    save(trace, output)
    try:
        with launch_browser(playwright, suite) as browser:
            stage['cspViolations'] = browser.csp.events
            capture(browser, trace, output)
            if any(error['stage'] == name for error in trace['browserErrors']):
                raise AssertionError('Browser page errors during ' + name)
            # Only a diagnostic precheck: the strict aggregate validator still owns the final verdict.
            limit = {'definition': 300, 'overview': 16}[name]
            observations = stage['samples'] + stage.get('boundaries', {}).get('observations', [])
            if any(sample['durationMs'] > limit for sample in observations):
                raise StageBudgetFailure(name + ' has raw observations over ' + str(limit) + ' ms')
    except StageBudgetFailure as error:
        stage['diagnosticFailure'] = str(error)
    except BaseException as error:
        stage.update(status='failed', error={'type': type(error).__name__, 'message': str(error)})
        if not isinstance(error, Exception):
            raise
    finally:
        trace['cspViolations'].extend({'stage': name, **event} for event in stage['cspViolations'])
        save(trace, output)


def run():
    output = results_dir() / 'editor-ui-budgets.json'
    trace = {'format': 'sharpforge-editor-ui-budgets', 'version': 1, 'units': 'milliseconds',
             'captureStatus': 'incomplete', 'fixture': fixture(), 'browserErrors': [], 'cspViolations': [],
             'stages': {name: {'status': 'pending', 'samples': []} for name in ['definition', 'overview']}}
    try:
        if os.getenv('SHARPFORGE_IN_MEMORY') == '1':
            raise RuntimeError('Editor UI budget evidence requires production HTTP/CSP, not an in-memory loader')
        trace['source'] = provenance()
        with sync_playwright() as playwright:
            for name, capture in [('definition', capture_definition), ('overview', capture_overview)]:
                capture_stage(playwright, trace, output, name, capture)
        trace['captureStatus'] = 'completed' if all(stage['status'] == 'captured' for stage in trace['stages'].values()) else 'failed'
        save(trace, output)
        status, trace['assessment'] = assess(output)
        save(trace, output)
        if status:
            raise AssertionError('Editor browser budget qualification failed: ' + repr(trace['assessment']))
    except BaseException as error:
        trace['failure'] = {'type': type(error).__name__, 'message': str(error)}
        raise
    finally:
        save(trace, output)
        print(json.dumps({'captureStatus': trace['captureStatus'], 'assessment': trace.get('assessment'),
                          'failure': trace.get('failure'), 'trace': str(output)}, indent=2))


if __name__ == '__main__':
    run()
