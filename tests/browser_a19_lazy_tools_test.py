"""Real first activation under production HTTP/CSP; rejects all external network requests."""
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
from browser_harness import load_application, wait_condition
from conformance.browser.launch import launch_browser

modules = {'designer-tools.js', 'assembly-workbench.js', 'disassembly-tool.js', 'msbuild-tools.js', 'project-wizard.js'}

with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.route('**/*', lambda route: route.continue_() if urlparse(route.request.url).hostname == '127.0.0.1' else route.abort())
    requested, errors = [], []
    context.on('request', lambda request: requested.append(urlparse(request.url).path.rsplit('/', 1)[-1]))
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    load_application(page)
    wait_condition(page, '!!window.sharpforge && !!document.querySelector("[data-dock-tab^=source]")')
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
    wait_condition(page, 'async () => (await sharpforge.designer.get()).document !== undefined')
    assert 'designer-tools.js' in requested
    page.evaluate('''() => { window.lazyWizard = sharpforge.openProjectWizard(); }''')
    page.locator('#modal-backdrop:not(.hidden)').wait_for()
    assert 'project-wizard.js' in requested
    page.locator('#modal-close').click()
    for module in modules:
        assert requested.count(module) == 1, (module, requested)
    assert not errors, errors
    print('A19 lazy tools: cold graph excludes all five controllers; first activation succeeds using local built assets')
