"""Real concurrent runtime workers and WinUI DOM; uses Studio's explicit app-host automation contribution."""
import json
import time

from playwright.sync_api import sync_playwright
from browser_harness import load_application
from conformance.browser.launch import launch_browser, results_dir

REPORT = results_dir() / 'browser-designer-app-host-results.json'
checks = []
SOURCE = '''using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
class Program
{
    static int count;
    static Button action;
    static void Main()
    {
        var window = new Window() { Title = "Parallel counter" };
        action = new Button() { Name = "Counter", Content = "Count 0", Width = 180, Height = 40 };
        action.Click += OnClick;
        window.Content = action;
        window.Activate();
    }
    static void OnClick(object sender, RoutedEventArgs args)
    {
        count++;
        action.Content = "Count " + count;
    }
}
'''


def truth(value, message='assertion failed'):
    if not value:
        raise AssertionError(message)


def checked(name, action):
    started = time.perf_counter()
    action()
    checks.append({'name': name, 'passed': True, 'milliseconds': round((time.perf_counter() - started) * 1000, 2)})
    print('PASS', name, flush=True)


try:
    with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
        page = browser.new_page(viewport={'width': 1800, 'height': 1100}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        load_application(page)
        page.evaluate('(text) => sharpforge.loadDiskRecords([{path:"Program.cs",text}], {name:"Parallel apps",mode:"folder"})', SOURCE)
        page.evaluate('sharpforge.run()')
        page.wait_for_function('async () => (await sharpforge.getUIScene()).windows.length === 1')
        first = page.evaluate('sharpforge.designerApps.launch({uri:"Program.cs"})')
        second = page.evaluate('sharpforge.designerApps.launch({uri:"Program.cs"})')

        def panel(app):
            return page.locator(f'[data-app-session="{app["sessionId"]}"][data-app-generation="{app["generation"]}"]')

        def wait_count(app, count):
            panel(app).get_by_role('button', name=f'Count {count}', exact=True).wait_for()

        wait_count(first, 0)
        wait_count(second, 0)
        second_title = panel(second).locator('.designer-app-host-title')
        second_title.focus()
        for _ in range(20):
            second_title.press('Shift+ArrowRight')

        def independent_apps():
            truth(first['sessionId'] != second['sessionId'])
            truth(page.evaluate('sharpforge.designerApps.list().length') == 2)
            panel(first).get_by_role('button', name='Count 0', exact=True).click()
            wait_count(first, 1)
            wait_count(second, 0)
            panel(second).get_by_role('button', name='Count 0', exact=True).click()
            wait_count(second, 1)
            truth(page.evaluate('async () => (await sharpforge.getUIScene()).nodes.find(n => n.properties.Name === "Counter").properties.Content') == 'Count 0')

        checked('two actual worker apps run managed callbacks independently of each other and the main debugger', independent_apps)

        def pause_and_resume():
            page.wait_for_function('(id) => sharpforge.designerApps.list().find(app => app.sessionId === id).runtimeState === "terminated"',
                                   arg=first['sessionId'])
            panel(first).get_by_role('button', name='Pause', exact=True).click()
            page.wait_for_function('(id) => sharpforge.designerApps.list().find(app => app.sessionId === id).state === "paused"', arg=first['sessionId'])
            paused = page.evaluate('(id) => sharpforge.designerApps.list().find(app => app.sessionId === id)', first['sessionId'])
            truth(paused['pauseKind'] == 'idle-ui' and paused['runtimeState'] == 'terminated' and paused['pauseAcknowledged'])
            truth('UI paused' in panel(first).locator('.designer-app-host-state').inner_text())
            panel(first).get_by_role('button', name='Count 1', exact=True).click()
            wait_count(first, 1)
            panel(second).get_by_role('button', name='Count 1', exact=True).click()
            wait_count(second, 2)
            panel(first).locator('.designer-app-host-title').focus()
            page.keyboard.press('F5')
            page.wait_for_function('(id) => sharpforge.designerApps.list().find(app => app.sessionId === id).state !== "paused"', arg=first['sessionId'])
            panel(first).get_by_role('button', name='Count 1', exact=True).click()
            wait_count(first, 2)

        checked('idle UI Pause and scoped F5 Continue preserve terminated VM state and affect only that app window', pause_and_resume)

        def visual_selection():
            snapshot = page.evaluate('(app) => sharpforge.designerApps.snapshot(app.sessionId, app.generation)', second)
            button = next(node['id'] for node in snapshot['scene']['nodes'] if node['properties'].get('Name') == 'Counter')
            page.evaluate('({app,id}) => sharpforge.designerApps.select(app.sessionId, app.generation, [id])', {'app': second, 'id': button})
            truth(panel(second).locator('.designer-app-host-selected').count() == 1)
            truth(panel(first).locator('.designer-app-host-selected').count() == 0)
            panel(second).get_by_role('button', name='Live tree', exact=True).click()
            panel(second).get_by_role('treeitem').filter(has_text='Window').first.click()
            selected = page.evaluate('(app) => sharpforge.designerApps.selection(app.sessionId,app.generation)', second)
            truth(selected == snapshot['scene']['windows'])
            panel(second).get_by_role('button', name='Live tree', exact=True).click()

        checked('runtime tree and designer selection carry explicit app identity', visual_selection)

        def restart_and_stop():
            global first
            previous = first
            first = page.evaluate('(app) => sharpforge.designerApps.restart(app.sessionId, app.generation)', first)
            truth(first['sessionId'] == previous['sessionId'] and first['generation'] > previous['generation'])
            truth(panel(previous).count() == 0)
            wait_count(first, 0)
            wait_count(second, 2)
            stale = page.evaluate('async (app) => { try { await sharpforge.designerApps.snapshot(app.sessionId, app.generation); return false; } '
                                  'catch { return true; } }', previous)
            truth(stale, 'stale generation was accepted')
            panel(first).get_by_role('button', name='Stop', exact=True).click()
            truth(panel(first).count() == 0)
            panel(second).get_by_role('button', name='Count 2', exact=True).click()
            wait_count(second, 3)

        checked('restart publishes a fresh generation and stop leaves other workers responsive', restart_and_stop)

        def execution_profiles():
            for profile in ['source-vm', 'managed-il']:
                app = page.evaluate('(profile) => sharpforge.designerApps.launch({uri:"Program.cs",profile})', profile)
                wait_count(app, 0)
                panel(app).get_by_role('button', name='Count 0', exact=True).click()
                wait_count(app, 1)
                panel(app).get_by_role('button', name='Stop', exact=True).click()

        checked('source VM and direct managed IL profiles render and dispatch actual managed callbacks', execution_profiles)

        def workspace_cleanup():
            page.evaluate('sharpforge.execute("stop")')
            wait_count(second, 3)
            truth(page.evaluate('sharpforge.designerApps.list().length') == 1)
            page.evaluate('sharpforge.loadDiskRecords([{path:"Program.cs",text:"class Program { static void Main() {} }"}],'
                          '{name:"Another workspace",mode:"folder"})')
            truth(page.evaluate('sharpforge.designerApps.list().length') == 0)
            truth(page.locator('.designer-app-host').count() == 0)

        checked('workspace replacement disposes every parallel runtime and modeless window', workspace_cleanup)
        truth(not errors, '\n'.join(errors))
        REPORT.write_text(json.dumps({'passed': True, 'checks': checks}, indent=2))
except Exception as error:
    REPORT.write_text(json.dumps({'passed': False, 'checks': checks, 'error': str(error)}, indent=2))
    raise
