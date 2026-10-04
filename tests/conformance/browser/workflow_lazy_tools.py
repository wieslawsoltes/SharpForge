"""Observe the real lazy tool surfaces without instrumenting module/controller factories."""
from browser_harness import wait_condition


def activate_offline_panels(page):
    rows = []
    panels = [('assembly', '[data-open-assembly]'), ('disassembly', '.empty-state'), ('msbuild', '.msbuild-tool')]
    for panel, content in panels:
        selector = f'[data-tool="{panel}"]'
        if page.locator(selector + ' ' + content).count():
            raise AssertionError('Tool already initialized before its first activation: ' + panel)
        page.evaluate('id => sharpforge.openTool(id)', panel)
        wait_condition(page, '''() => {
            const host = document.querySelector(%s);
            return host && host.querySelector(%s) && !host.hasAttribute('aria-busy') && !host.querySelector('[role=alert]');
        }''' % (repr(selector), repr(content)))
        host = page.locator(selector)
        if host.count() != 1 or host.locator(content).count() != 1:
            raise AssertionError('Expected one actual mounted tool surface: ' + panel)
        page.evaluate('id => sharpforge.openTool(id)', panel)
        if host.count() != 1 or host.locator(content).count() != 1:
            raise AssertionError('Repeated activation duplicated the tool surface: ' + panel)
        rows.append({'tool': panel, 'passed': True, 'mountedHosts': 1, 'reopened': True})
    return rows


def verify_offline_reopen(page, identity):
    page.evaluate('sharpforge.designer.open()')
    value = page.evaluate('id => sharpforge.designer.get().document.nodes.find(node => node.id === id)?.properties.Content', identity)
    if value != 'Shell workflow' or page.locator('[data-tool="designer"] .design-stage').count() != 1:
        raise AssertionError('Reopening the designer lost its owned document or duplicated its surface')
    page.evaluate('void sharpforge.openProjectWizard()')
    page.locator('#modal-backdrop:not(.hidden)').wait_for()
    if page.locator('[data-template="console"]').count() != 1:
        raise AssertionError('Project wizard did not mount its actual template chooser once')
    page.locator('#modal-close').click()
    wait_condition(page, 'document.querySelector("#modal-backdrop").classList.contains("hidden")')
    return [{'tool': 'wizard', 'passed': True, 'reopened': True},
            {'tool': 'designer', 'passed': True, 'mountedHosts': 1, 'reopened': True, 'documentRetained': True}]
