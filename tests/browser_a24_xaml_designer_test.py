"""Generated native XAML pairs in the browser designer; literal markup writes use workspace transactions."""
import json
import time
from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir
from browser_harness import load_application

RESULTS = results_dir()
checks = []


def truth(value, message='assertion failed'):
    if not value:
        raise AssertionError(message)


def check(name, action):
    start = time.perf_counter()
    action()
    checks.append({'name': name, 'passed': True, 'milliseconds': (time.perf_counter() - start) * 1000})
    print('PASS', name, flush=True)


with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
    page = browser.new_page(viewport={'width': 1600, 'height': 1100})
    page.set_default_timeout(15000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    load_application(page)
    page.evaluate('''async () => {
        const { createItemPlan } = await __sharpforgeTestImport('/packages/templates/src/index.js');
        const records = [
            { path: 'DesignerHost.csproj', text: '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>' +
                '<OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><EnableDefaultCompileItems>false</EnableDefaultCompileItems>' +
                '</PropertyGroup><ItemGroup><Compile Include="Program.cs"/></ItemGroup></Project>' },
            { path: 'Program.cs', text: 'class Program { static void Main() { System.Console.WriteLine("Designer host"); } }' }
        ];
        for (const [kind, name] of [['page','ExamplePage'],['window','ExampleWindow'],['user-control','ExampleControl'],['content-dialog','ExampleDialog']]) {
            records.push(...createItemPlan('winui-xaml-' + kind, { name: name + '.xaml', namespace: 'Example.Native', folder: 'Views' }).records);
        }
        window.__xamlOriginalRecords = structuredClone(records);
        await sharpforge.loadDiskRecords(records, { name: 'DesignerHost', entry: 'DesignerHost.csproj' });
        sharpforge.designer.open();
        sharpforge.designer.setAutoSync(false);
    }''')

    def source(path='Views/ExamplePage.xaml'):
        return page.evaluate('path => sharpforge.getWorkspace().records.find(record => record.path === path).text', path)

    def design():
        return page.evaluate('sharpforge.designer.get()')

    def load_pairs():
        for name in ['ExamplePage', 'ExampleWindow', 'ExampleControl', 'ExampleDialog']:
            page.evaluate('uri => sharpforge.designer.connect(uri)', 'Views/' + name + '.xaml')
            state = design()
            truth(state['sourceSync']['state'] == 'synced' and state['sourceSync']['format'] == 'xaml')
            truth(not state['sourceSync']['warnings'])
            label = next(node for node in state['document']['nodes'] if node['type'].endswith('.TextBlock'))
            truth(label['properties']['Text'] == name)
            truth(page.locator('.design-preview [data-sf-id="' + label['id'] + '"]').count() == 1)
        page.evaluate('sharpforge.designer.connect("Views/ExamplePage.xaml")')

    check('Generated Page, Window, UserControl and ContentDialog XAML load into the actual designer without unsupported API diagnostics', load_pairs)

    def scalar_write():
        before = source()
        behind = source('Views/ExamplePage.xaml.cs')
        label = next(node for node in design()['document']['nodes'] if node['type'].endswith('.TextBlock'))
        page.evaluate('id => sharpforge.designer.set("Text", "Edited λ 😀", [id])', label['id'])
        page.evaluate('sharpforge.designer.writeSource()')
        truth(source() == before.replace('Text="ExamplePage"', 'Text="Edited λ 😀"'))
        truth(source('Views/ExamplePage.xaml.cs') == behind)
        truth(design()['sourceSync']['state'] == 'synced')
        truth(page.locator('.design-preview [data-sf-id="' + label['id'] + '"]').inner_text() == 'Edited λ 😀')

    check('Designer scalar changes write one XML span through workspace history and preserve the native code-behind', scalar_write)

    def source_editor():
        page.locator('.design-sync-bar [data-sync="source"]').click()
        editor = page.get_by_role('textbox', name='XAML source editor')
        editor.fill(source().replace('Edited λ 😀', 'Edited from XAML source'))
        page.get_by_role('button', name='Apply XAML', exact=True).click()
        page.wait_for_function('!document.querySelector("dialog[open]")')
        page.evaluate('sharpforge.designer.readSource()')
        truth(any(node.get('properties', {}).get('Text') == 'Edited from XAML source' for node in design()['document']['nodes']))

    check('The XAML source editor updates the actual file and a source read updates the rendered designer', source_editor)

    def structural_write():
        grid = next(node for node in design()['document']['nodes'] if node['type'].endswith('.Grid'))['id']
        added = page.evaluate('parent => sharpforge.designer.add("TextBox", parent)', grid)
        page.evaluate('id => sharpforge.designer.set("Text", "Added control", [id])', added)
        page.evaluate('sharpforge.designer.writeSource()')
        truth('<TextBox ' in source() and 'x:Class="Example.Native.ExamplePage"' in source())
        truth(page.evaluate('''() => __xamlOriginalRecords.filter(record => record.path.endsWith('.xaml.cs')).every(original =>
            sharpforge.getWorkspace().records.find(record => record.path === original.path).text === original.text)'''))
        truth(not design()['sourceSync']['dirty'])

    check('Adding a designer control rewrites supported markup while retaining class metadata and every code-behind file', structural_write)

    def cancel_editor():
        before = source()
        page.locator('.design-sync-bar [data-sync="source"]').click()
        page.get_by_role('textbox', name='XAML source editor').fill('<Incomplete')
        page.get_by_role('button', name='Cancel', exact=True).click()
        truth(source() == before)
        truth(design()['sourceSync']['state'] == 'synced')

    check('Cancelling an incomplete source edit leaves the file and synchronized preview unchanged', cancel_editor)
    check('No page JavaScript errors', lambda: truth(not errors, json.dumps(errors)))
    (RESULTS / 'browser-a24-xaml-designer.json').write_text(json.dumps({
        'passed': len(checks), 'checks': checks, 'errors': errors,
        'target': 'Chromium HTTP/CSP designer with literal XAML',
        'nativeCodeBehind': 'Preserved exactly; native compilation requires the Windows App SDK runner',
        'bindings': 'Unregistered markup extensions are diagnosed; this suite does not claim native XAML binding execution'
    }, indent=2) + '\n', encoding='utf8')
