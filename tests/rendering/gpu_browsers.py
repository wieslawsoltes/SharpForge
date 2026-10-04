"""Actual browser launchers: WebKit and Safari are reported as different engines."""
import base64
import json
import platform
import subprocess
import time
import urllib.request
from contextlib import contextmanager


class SafariPage:
    def __init__(self, endpoint):
        self.endpoint = endpoint.rstrip('/')
        session = self.request('POST', '/session', {'capabilities': {'alwaysMatch': {'browserName': 'safari'}}})
        self.session = session['sessionId']
        self.version = session.get('capabilities', {}).get('browserVersion', 'unknown')

    def request(self, method, path, value=None):
        data = None if value is None else json.dumps(value).encode()
        request = urllib.request.Request(self.endpoint + path, data=data, method=method, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=180) as response:
            result = json.load(response)['value']
        if isinstance(result, dict) and 'error' in result:
            raise RuntimeError(str(result))
        return result

    def navigate(self, url):
        self.request('POST', '/session/' + self.session + '/timeouts', {'script': 180000, 'pageLoad': 30000})
        self.request('POST', '/session/' + self.session + '/window/rect', {'width': 1280, 'height': 1300})
        self.request('POST', '/session/' + self.session + '/url', {'url': url})
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if self.request('POST', '/session/' + self.session + '/execute/sync', {'script': 'return !!globalThis.renderingConformance;', 'args': []}):
                return
            time.sleep(0.05)
        raise TimeoutError('Safari fixture module did not become ready')

    def run(self, value):
        script = 'const done=arguments[arguments.length-1];globalThis.renderingConformance.run(arguments[0]).then(value=>done({value}),error=>done({error:String(error)}));'
        result = self.request('POST', '/session/' + self.session + '/execute/async', {'script': script, 'args': [value]})
        if 'error' in result:
            raise RuntimeError(result['error'])
        return result['value']

    def screenshot(self, path):
        value = self.request('GET', '/session/' + self.session + '/screenshot')
        path.write_bytes(base64.b64decode(value))

    def close(self):
        try:
            self.request('POST', '/session/' + self.session + '/execute/async', {
                'script': 'const done=arguments[arguments.length-1];Promise.resolve(globalThis.renderingConformance?.dispose()).then(done,done);',
                'args': []})
        finally:
            self.request('DELETE', '/session/' + self.session)


class PlaywrightPage:
    def __init__(self, browser):
        self.browser = browser
        self.page = browser.new_page(viewport={'width': 1200, 'height': 1100}, device_scale_factor=1)
        self.version = browser.version
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))

    def navigate(self, url):
        response = self.page.goto(url)
        if response.status != 200:
            raise RuntimeError('Fixture server failed: ' + str(response.status))
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if self.page.evaluate('() => !!globalThis.renderingConformance'):
                return
            time.sleep(0.05)
        raise TimeoutError('Fixture module did not become ready: ' + '; '.join(self.errors))

    def run(self, value):
        self.errors.clear()
        result = self.page.evaluate('value => globalThis.renderingConformance.run(value)', value)
        result['errors'].extend(self.errors)
        return result

    def screenshot(self, path):
        self.page.screenshot(path=str(path), full_page=False)

    def close(self):
        try:
            self.page.evaluate('() => globalThis.renderingConformance?.dispose()')
        finally:
            self.browser.close()


@contextmanager
def launch(engine, configuration, *, executable=None, safari_endpoint=None):
    if engine == 'safari':
        if platform.system() != 'Darwin' and not safari_endpoint:
            raise RuntimeError('Real Safari requires macOS safaridriver or an explicit WebDriver endpoint')
        process = None
        if not safari_endpoint:
            import socket
            with socket.socket() as reservation:
                reservation.bind(('127.0.0.1', 0))
                port = reservation.getsockname()[1]
            process = subprocess.Popen(['/usr/bin/safaridriver', '--port', str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            safari_endpoint = 'http://127.0.0.1:' + str(port)
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                try:
                    urllib.request.urlopen(safari_endpoint + '/status', timeout=1).close()
                    break
                except OSError:
                    time.sleep(0.05)
        page = None
        try:
            page = SafariPage(safari_endpoint)
            yield page
        finally:
            try:
                if page:
                    page.close()
            finally:
                if process:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
        return
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        options = {'headless': True}
        if executable:
            options['executable_path'] = executable
        if engine == 'chromium':
            options['args'] = configuration.get('launchArguments', [])
        if engine == 'firefox':
            options['firefox_user_prefs'] = {'dom.webgpu.enabled': True}
        page = PlaywrightPage(getattr(playwright, engine).launch(**options))
        try:
            yield page
        finally:
            page.close()
