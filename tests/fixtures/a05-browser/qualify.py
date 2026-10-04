"""Serial browser A05 qualification. Missing browser/UI dependencies are failures, never skips."""
import argparse
from contextlib import ExitStack
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time
import traceback
from urllib.parse import urlparse

from server import serving, source_handler, ui_handler
from speedscope import PIN, import_file, prepare, verify

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tests'))
CASES = ('wasm-execution', 'debugger-deopt', 'profile-exports', 'csp-denied-fallback',
         'speedscope-source', 'speedscope-reload', 'speedscope-cil')
MODULE = '/tests/fixtures/a05-browser/'


def write_report(path, report):
    report['passed'] = all(row.get('passed') is True for row in report['cases'])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')


def provenance(engine):
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=ROOT, text=True, timeout=10).strip()
    return {'format': 'SharpForge.A05BrowserQualification/1', 'revision': git('rev-parse', 'HEAD'),
            'tree': git('rev-parse', 'HEAD^{tree}'), 'trackedChanges': git('status', '--porcelain', '--untracked-files=no'),
            'engine': engine, 'host': platform.platform(), 'machine': platform.machine(), 'python': sys.version,
            'node': subprocess.check_output(['node', '--version'], text=True, timeout=10).strip(),
            'workflow': {key: os.environ.get(key) for key in ('GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_REF')},
            'command': [sys.executable, *sys.argv], 'speedscope': PIN,
            'fixtureSha256': {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                              for path in sorted(Path(__file__).parent.glob('*')) if path.suffix in ('.py', '.mjs')},
            'scope': 'Actual browser public source modules over HTTP with shipped CSP plus hashed fixture import map; '
                     'official Speedscope release UI imported using its real file input. No Studio or native CLR claim.',
            'cases': [{'id': name, 'passed': False, 'status': 'not-run'} for name in CASES]}


def expected_csp(events, url):
    violations = [event for event in events if event.get('source') == 'event']
    if not violations:
        raise AssertionError('Real CSP denial must produce a browser securitypolicyviolation event')
    for event in events:
        if event.get('source') == 'event':
            valid = (event.get('documentURI') == url and event.get('directive') in ('script-src', 'script-src-elem')
                     and event.get('blockedURI') in ('wasm-eval', 'eval') and event.get('disposition') == 'enforce')
        else:
            valid = event.get('source') == 'console' and event.get('url') == url and 'script-src' in event.get('message', '')
        if not valid:
            raise AssertionError('Unexpected CSP violation in denial-only document: ' + repr(event))


def restrict_requests(context):
    blocked = []
    def route(request):
        parsed = urlparse(request.request.url)
        if parsed.scheme in ('data', 'blob') or parsed.hostname == '127.0.0.1':
            request.continue_()
        else:
            blocked.append(request.request.url)
            request.abort()
    context.route('**/*', route)
    return blocked


def runtime_case(playwright, engine, name, source_url, policies, output):
    from conformance.browser.launch import launch_browser
    denied = name == 'csp-denied-fallback'
    path = 'denied' if denied else 'allowed'
    url = source_url + '/' + path + '.html'
    function = {'wasm-execution': 'wasmExecution', 'debugger-deopt': 'debuggerDeopt',
                'profile-exports': 'profileExports', 'csp-denied-fallback': 'cspDeniedFallback'}[name]
    module = MODULE + ('profiles.mjs' if name == 'profile-exports' else 'runtime.mjs')
    result, events = None, []
    caught_expected_violation = False
    try:
        with launch_browser(playwright, name, engine=engine, mode='A05 public runtime / ' + path + ' CSP') as browser:
            context = browser.new_context(locale='en-US', viewport={'width': 1280, 'height': 900})
            blocked = restrict_requests(context)
            page = context.new_page()
            page.set_default_timeout(15000)
            response = page.goto(url)
            if response is None or response.status != 200 or response.headers.get('content-security-policy') != policies[path]:
                raise AssertionError('Fixture did not receive the exact expected HTTP CSP')
            result = page.evaluate('async ({module, name}) => (await import(module))[name]()', {'module': module, 'name': function})
            if not result.get('passed'):
                raise AssertionError('Browser runtime fixture did not pass: ' + repr(result))
            result.update({'browserVersion': browser.version, 'csp': policies[path], 'blockedRequests': blocked})
            if blocked:
                raise AssertionError('Runtime fixture attempted an external network request')
            if denied:
                # Flush event bindings before checking the launcher's expected negative observation.
                page.evaluate('() => new Promise(resolve => setTimeout(resolve, 0))')
            events = browser.csp.events
    except AssertionError as error:
        # The shared launcher deliberately fails on CSP violations. Only this exact
        # denial fixture may interpret its independently verified negative result.
        if not denied or result is None or type(error).__name__ != 'CspViolation':
            raise
        expected_csp(events, url)
        caught_expected_violation = True
    if denied:
        if not caught_expected_violation:
            raise AssertionError('CSP monitor did not observe the expected compile denial')
        result['expectedCspViolations'] = events
    if name == 'profile-exports':
        for exported in result['exports']:
            file = output / ('profile-' + exported['engine'] + '.speedscope.json')
            file.write_text(json.dumps(exported.pop('file'), indent=2) + '\n', encoding='utf8')
            exported['file'] = file.name
            exported['fileSha256'] = hashlib.sha256(file.read_bytes()).hexdigest()
    return result


def speedscope_case(playwright, engine, name, ui_url, exported, output):
    from conformance.browser.launch import launch_browser
    with launch_browser(playwright, name, engine=engine, mode='Official Speedscope UI file import') as browser:
        context = browser.new_context(locale='en-US', viewport={'width': 1280, 'height': 900})
        blocked = restrict_requests(context)
        page = context.new_page()
        page.set_default_timeout(15000)
        result = import_file(page, ui_url, output / exported['file'], exported, output / name)
        if blocked:
            raise AssertionError('Official offline UI requested an external resource: ' + repr(blocked))
        result.update({'browserVersion': browser.version, 'blockedRequests': blocked})
        return result


def run(args, report, report_path):
    from playwright.sync_api import sync_playwright
    report['playwright'] = version('playwright')
    # Keep runtime qualification independent of tool download/import failures.
    manifest = None
    try:
        manifest = verify(args.assets)
        report['speedscope'] = manifest
    except Exception as error:
        report['speedscopeSetupError'] = str(error)
    handler, policies = source_handler(ROOT)
    report['policies'] = policies
    exports = {}
    with ExitStack() as stack:
        source_url = stack.enter_context(serving(handler))
        ui_url = None
        if manifest:
            ui_origin = stack.enter_context(serving(ui_handler(args.assets / 'ui')))
            ui_url = ui_origin + '/' + manifest['entry']
        playwright = stack.enter_context(sync_playwright())
        for row in report['cases']:
            started = time.monotonic()
            row['status'] = 'running'
            write_report(report_path, report)
            try:
                name = row['id']
                if name.startswith('speedscope-'):
                    route = name.removeprefix('speedscope-')
                    if not ui_url or route not in exports:
                        raise RuntimeError('Required official UI or actual browser profile export is unavailable')
                    result = speedscope_case(playwright, args.engine, name, ui_url, exports[route], args.output)
                else:
                    result = runtime_case(playwright, args.engine, name, source_url, policies, args.output)
                    if name == 'profile-exports':
                        exports = {item['engine']: item for item in result['exports']}
                row.update(result)
                row['status'] = 'passed'
            except Exception as error:
                row.update({'passed': False, 'status': 'failed', 'error': str(error), 'traceback': traceback.format_exc()})
            finally:
                row['seconds'] = time.monotonic() - started
                write_report(report_path, report)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', choices=('chromium', 'firefox', 'webkit'), default='chromium')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/a05-browser')
    parser.add_argument('--assets', type=Path, default=ROOT / 'artifacts/a05-browser-assets')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--prepare', action='store_true')
    mode.add_argument('--finalize', action='store_true')
    args = parser.parse_args()
    args.output, args.assets = args.output.resolve(), args.assets.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    if args.prepare:
        prepare(args.assets)
        return 0
    report_path = args.output / 'report.json'
    if args.finalize and report_path.is_file():
        report = json.loads(report_path.read_text(encoding='utf8'))
    else:
        report = provenance(args.engine)
    os.environ['SHARPFORGE_RESULTS_DIR'] = str(args.output)
    if args.finalize:
        for row in report['cases']:
            if row['status'] in ('not-run', 'running'):
                row.update({'passed': False, 'status': 'failed', 'error': 'Required qualification did not complete; inspect workflow setup logs'})
        write_report(report_path, report)
        return 0
    write_report(report_path, report)
    try:
        if report['trackedChanges']:
            raise RuntimeError('Browser qualification requires clean tracked source for exact revision provenance')
        run(args, report, report_path)
    except BaseException as error:
        report['setupOrInterruptionError'] = {'type': type(error).__name__, 'message': str(error)}
        raise
    finally:
        write_report(report_path, report)
    print(json.dumps({'passed': report['passed'], 'report': str(report_path)}))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
