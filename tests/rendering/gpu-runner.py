#!/usr/bin/env python3
"""Render actual browser backends and preserve adapter, pixels, screenshots and failure evidence."""
import argparse
import base64
import hashlib
import http.server
import json
import math
import platform
import re
import subprocess
import threading
from contextlib import contextmanager
from pathlib import Path

from gpu_browsers import launch
from pixel_artifacts import golden_result, native_result, png_bytes
from inline_reference import canvas_result
from png_pixels import screenshot_pixels
from fixture_matrix import load_fixture_matrix, paired_reference_backend
from reference_policy import paired_result, verification_result, inspect_pixels

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


@contextmanager
def fixture_server():
    imports = {'@sharpforge/' + path.parent.parent.name: '/' + str(path.relative_to(ROOT)).replace('\\', '/')
               for path in (ROOT / 'packages').glob('*/src/index.js')}
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT), **kwargs)

        def log_message(self, *args):
            pass

        def do_GET(self):
            if self.path == '/tests/rendering/runner.html':
                html = (HERE / 'runner.html').read_text().replace('<!--IMPORTMAP-->',
                    '<script type="importmap" nonce="rendering-fixture">' + json.dumps({'imports': imports}) + '</script>')
                data = html.encode()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                policy = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'nonce-rendering-fixture'; "
                self.send_header('Content-Security-Policy', policy + "img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'")
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            super().do_GET()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield 'http://127.0.0.1:' + str(server.server_port) + '/tests/rendering/runner.html'
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)


def classify_adapter(adapter):
    text = ' '.join(str(adapter.get(key) or '') for key in ['vendor', 'architecture', 'device', 'description']).lower()
    if adapter.get('isFallbackAdapter') is True or any(name in text for name in ['swiftshader', 'llvmpipe', 'software', 'warp']):
        return 'software'
    if adapter.get('isFallbackAdapter') is False and any(name in text for name in ['intel', 'amd', 'nvidia', 'apple']):
        return 'hardware'
    return 'unverified'


def check_budget(metrics, budget):
    failures = []
    for key, limit in budget.items():
        measured = metrics.get(key)
        if type(limit) not in (int, float) or not math.isfinite(limit) or limit < 0:
            failures.append(key + ' has an invalid limit')
        elif type(measured) not in (int, float) or not math.isfinite(measured) or measured < 0:
            failures.append(key + ' was not measured')
        elif measured > limit:
            failures.append(key + ': ' + str(measured) + ' exceeds ' + str(limit))
    return {'passed': not failures, 'failures': failures, 'limits': budget}


def capture_pixels(page, result, output):
    screenshot = output / (result['id'] + '-browser.png')
    page.screenshot(screenshot)
    raster = result.pop('pixels', None)
    if raster:
        if raster.get('alphaMode') != 'premultiplied' or len(raster['rgba']) > 90 * 1024 * 1024:
            raise ValueError('Invalid browser RGBA packet')
        return (raster['width'], raster['height']), base64.b64decode(raster['rgba'], validate=True)
    return screenshot_pixels(screenshot.read_bytes(), result['captureRect'], result['viewport'])


def compare_capture(result, fixture, args, output, pixels, dimensions, paired=None):
    (output / (fixture['id'] + '-actual.png')).write_bytes(png_bytes(*dimensions, pixels))
    result['pixelSha256'] = hashlib.sha256(pixels).hexdigest()
    result['pixelDimensions'] = list(dimensions)
    if paired:
        reference, canvas_pixels = paired
        canvas, canvas_difference = paired_result(pixels, canvas_pixels, fixture, result, reference)
        result.pop('canvasReference', None)
    else:
        canvas, canvas_difference, canvas_pixels = canvas_result(result.pop('canvasReference', None), fixture, pixels, dimensions)
    result['canvasReference'] = canvas
    if canvas_pixels is not None:
        (output / (fixture['id'] + '-canvas.png')).write_bytes(png_bytes(*dimensions, canvas_pixels))
    if canvas_difference is not None:
        (output / (fixture['id'] + '-canvas-diff.png')).write_bytes(png_bytes(*dimensions, canvas_difference))
    directory = args.goldens / args.engine / platform.system().lower() / args.backend / result['actualTier']
    metadata = {name: result[name] for name in ['engine', 'browserVersion', 'adapter', 'actualBackend', 'actualTier', 'captureMode']}
    metadata.update({'fixture': fixture, 'commit': args.commit})
    comparison, difference = golden_result(directory, fixture, pixels, dimensions, metadata, update=args.update_goldens)
    result['golden'] = comparison
    result['golden']['required'] = args.require_goldens
    if difference:
        (output / (fixture['id'] + '-diff.png')).write_bytes(png_bytes(*dimensions, difference))
    native, difference = native_result(args.native_references, fixture, pixels, dimensions, windows_app_sdk=args.windows_app_sdk,
        browser_environment=(result.get('verification') or {}).get('environment'),
        browser_defaults=(result.get('verification') or {}).get('shapeDefaults'))
    result['nativeWinUI'] = native
    if difference:
        (output / (fixture['id'] + '-native-diff.png')).write_bytes(png_bytes(*dimensions, difference))
    baseline_passed = comparison['passed'] or comparison['status'] == 'missing-reference' and not args.require_goldens
    native_required = args.require_native or fixture.get('nativeReferenceRequired')
    return (canvas['passed'] and baseline_passed and native['status'] != 'failed'
            and (native['passed'] or not native_required))


def capture_pair(page, fixture, args, output, dimensions):
    backend = paired_reference_backend(fixture, args.backend)
    if backend is None:
        return None
    reference = page.run({'fixture': fixture, 'backend': backend, 'tier': args.tier,
                          'samples': args.samples, 'warmup': args.warmup, 'captureReference': False})
    check = verification_result(reference, fixture)
    if not check['passed']:
        raise ValueError('Reference fixture verification did not complete: ' + str(check))
    reference['id'] = fixture['id'] + '-reference'
    reference_dimensions, pixels = capture_pixels(page, reference, output)
    if reference_dimensions != dimensions:
        raise ValueError('Paired backend capture dimensions differ')
    return reference, pixels


def run_fixture(page, fixture, args, budget, output):
    if hasattr(page, 'configure'):
        page.configure(fixture)
    pair = paired_reference_backend(fixture, args.backend)
    result = page.run({'fixture': fixture, 'backend': args.backend, 'tier': args.tier, 'samples': args.samples,
                       'warmup': args.warmup, 'captureReference': pair is None})
    result.update({'engine': args.engine, 'browserVersion': page.version, 'platform': platform.platform(), 'fixture': fixture})
    result['actualTier'] = classify_adapter(result.get('adapter', {}))
    result['adapter']['driver'] = args.driver_version
    result['adapter']['driverSource'] = 'runner-supplied inventory' if args.driver_version else 'unavailable from standard WebGPU API'
    if args.backend == 'webgpu' and result.get('actualBackend') == 'webgpu' and result['actualTier'] != args.tier:
        result['status'] = 'unqualified-adapter'
        result['errors'].append('Requested ' + args.tier + '; observed ' + result['actualTier'])
    if args.vendor and args.vendor.lower() not in json.dumps(result.get('adapter', {})).lower():
        result['status'] = 'unqualified-vendor'
        result['errors'].append('Requested vendor does not match observed adapter')
    dimensions, pixels = capture_pixels(page, result, output)
    expected_dimensions = (math.ceil(fixture['width'] * fixture.get('dpr', 1)), math.ceil(fixture['height'] * fixture.get('dpr', 1)))
    if dimensions != expected_dimensions:
        raise ValueError('Captured physical pixels do not match declared DIP dimensions and DPR')
    if result['captureMode'] == 'browser-composite' and abs(result['devicePixelRatio'] - fixture.get('dpr', 1)) > 0.001:
        raise ValueError('This browser cannot supply the declared screenshot DPR')
    paired = capture_pair(page, fixture, args, output, dimensions)
    comparison = compare_capture(result, fixture, args, output, pixels, dimensions, paired)
    result['budget'] = check_budget(result.get('metrics', {}), {**budget, **fixture.get('budgets', {}),
        **fixture.get(args.backend + 'Budgets', {}),
        **fixture.get(args.tier + 'Budgets', {})})
    result['semanticVerification'] = verification_result(result, fixture)
    result['pixelAssertions'] = inspect_pixels(pixels, dimensions, fixture)
    passed = (result['status'] == 'rendered' and comparison and result['budget']['passed']
              and result['semanticVerification']['passed'] and result['pixelAssertions']['passed'] and not result['errors'])
    result['status'] = 'passed' if passed else 'failed'
    return result


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', choices=['chromium', 'firefox', 'webkit', 'safari'], default='chromium')
    parser.add_argument('--tier', choices=['hardware', 'software'], default='hardware')
    parser.add_argument('--backend', choices=['webgpu', 'canvas2d', 'dom'], default='webgpu')
    parser.add_argument('--vendor', choices=['intel', 'amd', 'nvidia', 'apple'])
    parser.add_argument('--driver-version')
    parser.add_argument('--executable')
    parser.add_argument('--safari-endpoint')
    parser.add_argument('--fixture-url', help='Pre-hosted runner URL reachable by a remote Safari WebDriver')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/rendering')
    parser.add_argument('--goldens', type=Path, default=HERE / 'goldens')
    parser.add_argument('--native-references', type=Path, help='Read-only native WinUI oracle RGBA/metadata provider directory')
    parser.add_argument('--require-native', action='store_true')
    parser.add_argument('--native-only', action='store_true', help='Capture only the exact shared native XAML positive cases')
    parser.add_argument('--require-goldens', action='store_true', help='Also require the separate reviewed backend regression baseline')
    parser.add_argument('--fixtures', nargs='*')
    parser.add_argument('--samples', type=int, default=30)
    parser.add_argument('--warmup', type=int, default=10)
    parser.add_argument('--update-goldens', action='store_true', help='Explicitly replace backend pixels; never qualifies native parity')
    args = parser.parse_args()
    if not 1 <= args.samples <= 1000 or not 0 <= args.warmup <= 1000:
        parser.error('Sample counts exceed bounds')
    if args.require_native and args.native_references is None:
        parser.error('--require-native requires a native reference provider directory')
    if args.native_only and args.native_references is None:
        parser.error('--native-only requires an external native reference provider directory')
    manifest = load_fixture_matrix(HERE / 'fixtures', include_native=args.native_references is not None)
    args.windows_app_sdk = manifest['windowsAppSdkVersion']
    fixtures = [item for item in manifest['fixtures'] if not args.native_only or item['scene'] == 'native-xaml']
    if any(not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,95}', row['id']) for row in fixtures):
        parser.error('Invalid fixture identifier')
    if args.fixtures:
        unknown = set(args.fixtures) - {fixture['id'] for fixture in fixtures}
        if unknown:
            parser.error('Unknown fixtures: ' + ', '.join(sorted(unknown)))
        fixtures = [fixture for fixture in fixtures if fixture['id'] in args.fixtures]
    return args, fixtures


def failure_capture(page, fixture, error, output, engine):
    result = {'id': fixture['id'], 'status': 'failed', 'reason': str(error), 'engine': engine}
    try:
        page.screenshot(output / (fixture['id'] + '-failure.png'))
    except Exception as screenshot_error:
        result['screenshotError'] = str(screenshot_error)
    return result


def main():
    args, fixtures = arguments()
    configuration = json.loads((HERE / 'software-tier.config.json').read_text()) if args.tier == 'software' else {}
    budgets = json.loads((HERE / 'budgets.json').read_text())
    args.output.mkdir(parents=True, exist_ok=True)
    args.commit = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    report = {'version': 1, 'commit': args.commit, 'engine': args.engine, 'tier': args.tier, 'mockGpu': False,
              'nativeWinUIReference': 'pending-native', 'goldensUpdated': args.update_goldens,
              'browserReferencePolicy': 'Required independent browser reference or distinct backend pair; a golden update alone cannot qualify',
              'tests': []}
    try:
        with fixture_server() as url, launch(args.engine, configuration, executable=args.executable,
                                             safari_endpoint=args.safari_endpoint) as page:
            page.navigate(args.fixture_url or url)
            for fixture in fixtures:
                budget = budgets[args.tier]['large' if fixture.get('benchmark') else 'default'] if args.backend == 'webgpu' else {}
                try:
                    result = run_fixture(page, fixture, args, budget, args.output)
                except Exception as error:
                    result = failure_capture(page, fixture, error, args.output, args.engine)
                report['tests'].append(result)
                print(json.dumps({'fixture': fixture['id'], 'status': result['status']}), flush=True)
    except Exception as error:
        report['runnerError'] = str(error)
    report['passed'] = bool(report['tests']) and len(report['tests']) == len(fixtures) and 'runnerError' not in report
    report['passed'] = report['passed'] and all(row['status'] == 'passed' for row in report['tests'])
    if report['tests'] and all(row.get('nativeWinUI', {}).get('passed') for row in report['tests']):
        report['nativeWinUIReference'] = 'passed'
    elif any(row.get('nativeWinUI', {}).get('status') == 'failed' for row in report['tests']):
        report['nativeWinUIReference'] = 'failed'
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
