"""Real first activation against built local assets; rejects all external network requests."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser

ROOT = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(ROOT / 'dist')))
Thread(target=server.serve_forever, daemon=True).start()
modules = {'designer-tools.js', 'assembly-workbench.js', 'disassembly-tool.js', 'msbuild-tools.js', 'project-wizard.js'}

try:
    with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        context.route('**/*', lambda route: route.continue_() if urlparse(route.request.url).hostname == '127.0.0.1' else route.abort())
        requested, errors = [], []
        context.on('request', lambda request: requested.append(urlparse(request.url).path.rsplit('/', 1)[-1]))
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
        page.wait_for_function('window.sharpforge && document.querySelector("[data-dock-tab^=source]")')
        assert not modules.intersection(requested), requested
        for panel, module in [('assembly', 'assembly-workbench.js'), ('disassembly', 'disassembly-tool.js'),
                              ('msbuild', 'msbuild-tools.js')]:
            page.evaluate('(id) => sharpforge.openTool(id)', panel)
            page.wait_for_function('''id => {
                const node = document.querySelector(`[data-tool="${id}"]`);
                return node && node.childElementCount && !node.hasAttribute('aria-busy') && !node.querySelector('[role=alert]');
            }''', arg=panel)
            assert module in requested, (panel, requested)
        page.evaluate('sharpforge.designer.open()')
        page.wait_for_function('sharpforge.designer.get().document !== undefined')
        assert 'designer-tools.js' in requested
        page.evaluate('''() => { window.lazyWizard = sharpforge.openProjectWizard(); }''')
        page.locator('#modal-backdrop:not(.hidden)').wait_for()
        assert 'project-wizard.js' in requested
        page.locator('#modal-close').click()
        for module in modules:
            assert requested.count(module) == 1, (module, requested)
        assert not errors, errors
        print('A19 lazy tools: cold graph excludes all five controllers; first activation succeeds using local built assets')
finally:
    server.shutdown()
    server.server_close()
