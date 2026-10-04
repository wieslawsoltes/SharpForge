"""One supported browser session, with retained diagnostics on failure/cancellation.

Use with sync_playwright() as p, launch_browser(p, __file__) as browser.
CHROMIUM_EXECUTABLE must name an existing file; otherwise Playwright's pinned
Chromium is used. HTTP uses the production server and its actual CSP.
"""
from contextlib import contextmanager
from pathlib import Path
import json
import os
import queue
import signal
import socket
import subprocess
import threading
import time
import traceback

ROOT = Path(__file__).resolve().parents[3]
_session = None


def results_dir():
    directory = Path(os.getenv('SHARPFORGE_RESULTS_DIR') or ROOT / 'artifacts/results')
    if not directory.is_absolute():
        directory = ROOT / directory
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'screenshots').mkdir(exist_ok=True)
    return directory


ENGINES = ('chromium', 'firefox', 'webkit')


def selected_engine(environ=None, engine=None):
    environ = os.environ if environ is None else environ
    engine = engine or environ.get('SHARPFORGE_BROWSER_ENGINE', 'chromium')
    if engine not in ENGINES:
        raise ValueError('Unsupported browser engine: ' + engine)
    return engine


def launch_options(environ=None, engine=None, *, headless=True):
    environ = os.environ if environ is None else environ
    if not isinstance(headless, bool):
        raise ValueError('headless must be an explicit boolean')
    options = {'headless': headless}
    engine = selected_engine(environ, engine)
    variable = engine.upper() + '_EXECUTABLE'
    executable = environ.get(variable, '').strip()
    if executable:
        path = Path(executable).expanduser().resolve()
        if not path.is_file():
            raise ValueError(variable + ' is not a file: ' + str(path))
        options['executable_path'] = str(path)
    # The supported bundled browser needs no security-disabling launch flags.
    return options


class BrowserSession:
    def __init__(self, browser, suite, engine=None, *, mode=None, launch_config=None):
        self.engine = selected_engine(engine=engine)
        self.mode = mode
        self.launch_config = dict(launch_config if launch_config is not None else launch_options(engine=self.engine))
        from importlib.util import spec_from_file_location, module_from_spec
        spec = spec_from_file_location('sharpforge_csp_monitor', Path(__file__).with_name('csp_monitor.py'))
        module = module_from_spec(spec)
        spec.loader.exec_module(module)
        self.csp = module.CspMonitor()
        self.browser = browser
        self.directory = results_dir() / Path(suite).stem
        self.directory.mkdir(parents=True, exist_ok=True)
        self.contexts = []
        self.servers = []
        self.started = time.monotonic()
        self.log = (self.directory / 'console.log').open('w', encoding='utf8')
        self.closed = False
        self.cancelled = None
        self.cancel_file = Path(os.environ['SHARPFORGE_CANCEL_FILE']) if os.environ.get('SHARPFORGE_CANCEL_FILE') else None

    def check_cancelled(self):
        if self.cancel_file is not None and self.cancel_file.is_file():
            self.cancelled = 'Browser qualification cancelled by cooperative request'
        if self.cancelled:
            raise KeyboardInterrupt(self.cancelled)

    def __getattr__(self, name):
        return getattr(self.browser, name)

    def record(self, message):
        self.log.write(message + '\n')
        self.log.flush()

    def _page(self, page):
        page.on('console', lambda message: self.record('console.' + message.type + ': ' + message.text))
        page.on('pageerror', lambda error: self.record('pageerror: ' + str(error)))
        page.on('requestfailed', lambda request: self.record('requestfailed: ' + request.url + ' ' + str(request.failure)))
        page.on('crash', lambda: self.record('page crashed'))

    def new_context(self, **options):
        context = self.browser.new_context(**options)
        context.tracing.start(screenshots=True, snapshots=True, sources=True)
        context.add_init_script('window.__sharpforgeTestImport = path => import(path);')
        self.csp.attach(context)
        context.on('page', self._page)
        self.contexts.append(context)
        return context

    def new_page(self, **options):
        return _CheckedPage(self.new_context(**options).new_page(), self)

    def close(self, failure=None):
        if self.closed:
            return
        self.closed = True
        diagnostics = []
        if failure:
            self.record('failure: ' + ''.join(traceback.format_exception(type(failure), failure, failure.__traceback__)))
        for index, context in enumerate(self.contexts):
            suffix = '' if index == 0 else '-' + str(index)
            if failure:
                for page_index, page in enumerate(context.pages):
                    try:
                        name = 'screenshot' + suffix + ('' if page_index == 0 else '-' + str(page_index)) + '.png'
                        page.screenshot(path=str(self.directory / name), timeout=5000)
                    except Exception as error:
                        diagnostics.append(str(error))
            try:
                context.tracing.stop(path=str(self.directory / ('trace' + suffix + '.zip')) if failure else None)
            except Exception as error:
                diagnostics.append(str(error))
            try:
                context.close()
            except Exception as error:
                diagnostics.append(str(error))
        for server in self.servers:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
        self.browser.close()
        self.log.close()
        (self.directory / 'session.json').write_text(json.dumps({
            'suite': self.directory.name, 'passed': failure is None,
            'engine': self.engine, 'cspViolations': self.csp.events,
            'browser': self.browser.version, 'executable': self.launch_config.get('executable_path', 'playwright-managed'),
            'launchOptions': self.launch_config,
            'mode': self.mode or ('standalone HTML injection' if self.directory.name == 'standalone_test'
                                 else ('in-memory' if os.getenv('SHARPFORGE_IN_MEMORY') == '1' else 'http')),
            'seconds': time.monotonic() - self.started, 'diagnosticErrors': diagnostics,
        }, indent=2) + '\n', encoding='utf8')


class _CheckedPage:
    """Raise cancellation only after returning from Playwright's dispatcher.

    Raising inside a signal handler can tear down the sync API's greenlet and
    make trace/screenshot cleanup impossible. Public API calls remain unchanged;
    they return before cancellation unwinds the owning browser session.
    """
    def __init__(self, page, session):
        self._page, self._session = page, session

    def __getattr__(self, name):
        value = getattr(self._page, name)
        if not callable(value):
            return value
        def checked(*args, **kwargs):
            self._session.check_cancelled()
            result = value(*args, **kwargs)
            self._session.check_cancelled()
            return result
        return checked


@contextmanager
def launch_browser(playwright, suite, engine=None, *, mode=None, headless=True):
    global _session
    if _session is not None:
        raise RuntimeError('Nested browser sessions are unsupported')
    engine = selected_engine(engine=engine)
    options = launch_options(engine=engine, headless=headless)
    browser = getattr(playwright, engine).launch(**options)
    session = BrowserSession(browser, suite, engine, mode=mode, launch_config=options)
    _session = session
    handlers = {}
    def cancel(signum, frame):
        session.cancelled = 'Browser qualification cancelled by signal ' + str(signum)
    if threading.current_thread() is threading.main_thread():
        for name in ('SIGINT', 'SIGTERM', 'SIGBREAK'):
            if hasattr(signal, name):
                sig = getattr(signal, name)
                handlers[sig] = signal.signal(sig, cancel)
    failure = None
    try:
        yield session
        session.check_cancelled()
        session.csp.assert_clean()
    except BaseException as error:
        failure = error
        raise
    finally:
        try:
            session.close(failure)
        finally:
            for sig, handler in handlers.items():
                signal.signal(sig, handler)
            _session = None


def load_http(page, connect_origins=()):
    if _session is None:
        raise RuntimeError('HTTP loading requires launch_browser')
    url = os.getenv('SHARPFORGE_BROWSER_URL')
    if not url:
        ready = queue.Queue()
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        session = _session
        server = subprocess.Popen(['node', 'scripts/serve.js'], cwd=ROOT,
            env={**os.environ, 'PORT': str(port), 'SHARPFORGE_CONNECT_ORIGINS': ','.join(connect_origins)},
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8')
        _session.servers.append(server)
        def output():
            for line in server.stdout:
                session.record('server: ' + line.rstrip())
                if line.startswith('SharpForge Studio: '):
                    ready.put(line.split('SharpForge Studio: ', 1)[1].strip())
        threading.Thread(target=output, daemon=True).start()
        try:
            url = ready.get(timeout=15)
        except queue.Empty as error:
            raise RuntimeError('Production HTTP server did not become ready') from error
    response = page.goto(url)
    if response is None or response.status != 200:
        raise AssertionError('Application HTTP navigation failed')
    csp = response.headers.get('content-security-policy', '')
    if "script-src 'self'" not in csp or "'unsafe-eval'" in csp:
        raise AssertionError('Production CSP missing or permits unsafe-eval: ' + csp)
    page.wait_for_function('window.sharpforge && window.sharpforge.getState().metrics !== null', timeout=30000)
    return page
