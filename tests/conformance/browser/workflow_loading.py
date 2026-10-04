"""Production HTTP/file workflow loading; file mode cannot fetch HTTP resources."""
from pathlib import Path
import hashlib
import os
import re
from urllib.parse import urlparse

from browser_harness import complete_startup, load_application, wait_condition
from conformance.browser.launch import ROOT
from conformance.browser.matrix_common import policy


def workflow_mode(mode):
    if mode not in ('http', 'file'):
        raise ValueError('Workflow mode must be http or file: ' + str(mode))
    if os.getenv('SHARPFORGE_IN_MEMORY') == '1':
        raise ValueError('Workflow packaging qualification requires real HTTP or file navigation')
    return mode


def standalone_path():
    path = Path(os.getenv('SHARPFORGE_STANDALONE_PATH', 'artifacts/SharpForge-standalone.html')).expanduser()
    path = (path if path.is_absolute() else ROOT / path).resolve()
    if not path.is_file():
        raise FileNotFoundError('Build the standalone artifact before qualification: ' + str(path))
    return path


def observe_offline_requests(context, attempts):
    """Record attempted HTTP(S), including failed worker requests, and abort routed requests."""
    def requested(request):
        if urlparse(request.url).scheme in ('http', 'https'):
            attempts.append(request.url)
    context.on('request', requested)
    context.route(re.compile(r'^https?://'), lambda route: route.abort('internetdisconnected'))


def load_workflow(page, mode, observation):
    workflow_mode(mode)
    if mode == 'http':
        load_application(page)
        if urlparse(page.url).scheme not in ('http', 'https'):
            raise AssertionError('Static workflow did not navigate to an HTTP application: ' + page.url)
        observation.update({'mode': mode, 'url': page.url, 'offline': False})
        return
    path = standalone_path()
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    observation.update({'mode': mode, 'url': path.as_uri(), 'offline': True,
                        'artifact': str(path), 'artifactSha256': digest.hexdigest(), 'bytes': path.stat().st_size})
    page.goto(path.as_uri(), wait_until='domcontentloaded')
    if page.url != path.as_uri():
        raise AssertionError('Standalone workflow left the requested file URL: ' + page.url)
    meta = page.locator('meta[data-sharpforge-csp="standalone"][http-equiv="Content-Security-Policy" i]')
    if meta.count() != 1:
        raise AssertionError('Standalone production CSP metadata is missing or duplicated')
    observation['policy'] = policy({}, meta.get_attribute('content'))
    if "'sha256-" not in observation['policy']['value']:
        raise AssertionError('Standalone CSP lacks its generated entry-script hash')
    if not page.evaluate('''() => {
        const meta = document.querySelector('meta[data-sharpforge-csp="standalone"]');
        return [...document.scripts].every(script =>
            Boolean(meta.compareDocumentPosition(script) & Node.DOCUMENT_POSITION_FOLLOWING));
    }'''):
        raise AssertionError('Standalone CSP must precede every script')
    wait_condition(page, 'window.sharpforge && window.sharpforge.getState().metrics !== null')
    complete_startup(page)
