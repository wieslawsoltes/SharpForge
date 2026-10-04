"""Real Studio document isolation and view/lifetime acceptance; uses the shared CSP-preserving browser harness."""
import json
import os
import time
from pathlib import Path

from playwright.sync_api import sync_playwright
from browser_harness import load_application
from conformance.browser.launch import launch_browser, results_dir

ROOT = Path(__file__).resolve().parents[1]
RESULTS = results_dir()
REPORT = RESULTS / 'browser-designer-documents-results.json'
checks = []


def source(name):
    return '''using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
class ViewNAME
{
    public static Window Create()
    {
        var window = new Window() { Title = "View NAME" };
        var canvas = new Canvas() { Width = 960, Height = 640 };
        var action = new Button() { Name = "Action", Content = "NAME", Width = 160, Height = 40 };
        canvas.Children.Add(action);
        window.Content = canvas;
        return window;
    }
}
'''.replace('NAME', name) + '\n'.join('// User-owned comment ' + str(index) for index in range(90))


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
        page = browser.new_page(viewport={'width': 1600, 'height': 1000}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        load_application(page)
        records = [{'path': 'A.cs', 'text': source('A')}, {'path': 'B.cs', 'text': source('B')},
                   {'path': 'Program.cs', 'text': 'class Program { static void Main() {} }'}]
        page.evaluate('(records) => sharpforge.loadDiskRecords(records, {name:"Designer documents", mode:"folder"})', records)
        page.evaluate('async () => { await sharpforge.designerDocuments.open("A.cs", "split"); '
                      'await sharpforge.designerDocuments.open("B.cs", "split"); sharpforge.openFile("Program.cs"); }')

        def compatible_bars():
            for uri in ['A.cs', 'B.cs']:
                truth(page.locator(f'[data-source-uri="{uri}"] [data-document-view="design"]').count() == 1)
            truth(page.locator('[data-source-uri="Program.cs"] [data-document-view]').count() == 0)
            truth(page.evaluate('sharpforge.designerDocuments.list().documents.length') == 2)
            truth(page.evaluate('sharpforge.designerDocuments.probe("Program.cs").compatible') is False)

        checked('only compatible source documents receive Design/Split/Code controls', compatible_bars)

        def side_by_side():
            page.evaluate('''() => {
                const layout = sharpforge.getLayout();
                const find = node => node.type === 'group' ? (node.panels.includes('source:A.cs') ? node : null)
                    : find(node.first) || find(node.second);
                sharpforge.dockPanel('source:B.cs', find(layout.root).id, 'right');
                sharpforge.openFile('A.cs');
                sharpforge.designerDocuments.setView('A.cs', {mode:'split', zoom:1.25});
                sharpforge.designerDocuments.setView('B.cs', {mode:'split', zoom:.5});
                sharpforge.designerDocuments.setAutoSync('A.cs', false);
                sharpforge.designerDocuments.setAutoSync('B.cs', false);
            }''')
            truth(page.locator('[data-source-uri="A.cs"] .designer-document-panes').is_visible())
            truth(page.locator('[data-source-uri="B.cs"] .designer-document-panes').is_visible())

        checked('two designers remain visible in separate document groups', side_by_side)

        def isolate_editing():
            before = page.evaluate('sharpforge.designerDocuments.get("B.cs")')
            page.evaluate('''() => {
                sharpforge.designerDocuments.select('A.cs', ['action']);
                sharpforge.designerDocuments.setProperty('A.cs', 'Width', 312, ['action']);
            }''')
            first = page.evaluate('sharpforge.designerDocuments.get("A.cs")')
            second = page.evaluate('sharpforge.designerDocuments.get("B.cs")')
            truth(second == before, 'editing A changed B selection, document, zoom, history, or source sync')
            truth(first['selection'] == ['action'])
            truth(first['undoDepth'] == 1)
            truth(first['sourceSync']['state'] != second['sourceSync']['state'])
            page.evaluate('sharpforge.designerDocuments.undo("A.cs")')
            truth(page.evaluate('sharpforge.designerDocuments.get("A.cs").document.nodes.find(n=>n.id==="action").properties.Width') == 160)
            truth(page.evaluate('sharpforge.designerDocuments.get("B.cs")') == before)

        checked('selection, zoom, undo, and source-sync state are independent by URI', isolate_editing)

        def mode_and_caret():
            before_layout = page.evaluate('sharpforge.getLayout()')
            area = page.locator('[data-source-uri="A.cs"] textarea.sf-input')
            area.evaluate('(input) => { input.setSelectionRange(24, 55); input.scrollTop = 240; }')
            before_caret = area.evaluate('(input) => [input.selectionStart, input.selectionEnd, input.scrollTop]')
            page.evaluate('''() => {
                sharpforge.designerDocuments.setView('A.cs', {mode:'design'});
                sharpforge.designerDocuments.setView('A.cs', {mode:'code'});
                sharpforge.designerDocuments.setView('A.cs', {mode:'split'});
            }''')
            truth(page.evaluate('sharpforge.getLayout()') == before_layout, 'document mode changed the dock model')
            truth(area.evaluate('(input) => [input.selectionStart, input.selectionEnd, input.scrollTop]') == before_caret)
            splitter = page.locator('[data-source-uri="A.cs"] .designer-document-splitter')
            splitter.focus()
            splitter.press('Home')
            truth(page.evaluate('sharpforge.designerDocuments.get("A.cs").ratio') == .1)
            splitter.press('ArrowRight')
            truth(abs(page.evaluate('sharpforge.designerDocuments.get("A.cs").ratio') - .12) < .001)
            truth(page.evaluate('sharpforge.designerDocuments.get("B.cs").ratio') == .5)

        checked('mode switches preserve dock layout/caret/scroll and split ratios are keyboard accessible', mode_and_caret)

        def routing_and_shortcuts():
            page.evaluate('sharpforge.openTool("designer-properties")')
            properties = page.locator('[data-tool="designer-properties"]')
            truth(properties.is_visible(), 'Design Properties did not open in the dock')
            page.evaluate('sharpforge.openFile("A.cs")')
            page.keyboard.press('Shift+F7')
            page.wait_for_function('sharpforge.designerDocuments.get("A.cs").mode === "design"')
            page.keyboard.press('F7')
            page.wait_for_function('sharpforge.designerDocuments.get("A.cs").mode === "code"')
            truth(page.locator('[data-source-uri="A.cs"]').count() == 1, 'View Designer duplicated the source tab')
            page.evaluate('sharpforge.openFile("B.cs")')
            truth(properties.is_visible(), 'Design Properties closed while focusing B')
            truth(properties.get_attribute('data-designer-uri') == 'B.cs')
            page.evaluate('sharpforge.openFile("Program.cs")')
            truth(properties.is_visible(), 'Design Properties closed while focusing incompatible source')
            truth(properties.get_attribute('data-designer-uri') is None)
            truth(properties.get_attribute('aria-disabled') == 'true')
            truth('compatible C#' in properties.inner_text())

        checked('F7 targets the same document and side tools follow focused documents or show a neutral state', routing_and_shortcuts)

        def recovery():
            page.evaluate('''() => {
                sharpforge.designerDocuments.setView('A.cs', {mode:'split', zoom:1.25, ratio:.63});
                sharpforge.designerDocuments.setView('B.cs', {mode:'design', zoom:.5});
                sharpforge.designerDocuments.select('A.cs', ['action']);
            }''')
            saved = page.evaluate('sharpforge.designerDocuments.recovery()')
            if os.getenv('SHARPFORGE_IN_MEMORY') == '1':
                page.evaluate('(saved) => sharpforge.designerDocuments.restoreRecovery(saved)', saved)
            else:
                page.wait_for_function('''() => {
                    const saved = JSON.parse(localStorage.getItem('sharpforge.workspace.v1') || '{}');
                    return saved.designer?.documents?.some(d => d.uri === 'A.cs' && d.ratio === .63);
                }''')
                page.reload()
                page.wait_for_function('window.sharpforge?.designerDocuments !== undefined')
                page.evaluate('async () => { await sharpforge.designerDocuments.open("A.cs", "split"); '
                              'await sharpforge.designerDocuments.open("B.cs", "design"); }')
            first = page.evaluate('sharpforge.designerDocuments.get("A.cs")')
            second = page.evaluate('sharpforge.designerDocuments.get("B.cs")')
            truth(first['mode'] == 'split' and first['zoom'] == 1.25 and first['ratio'] == .63)
            truth(second['mode'] == 'design' and second['zoom'] == .5)
            truth(first['selection'] == ['action'])

        checked('workspace recovery restores different designer views per document', recovery)

        def standalone_design_document():
            design_text = (ROOT / 'examples/designer/CanvasCounter/View.sfdesign.json').read_text(encoding='utf-8')
            standalone = [records[2], {'path': 'Board.sfdesign.json', 'text': design_text}]
            page.evaluate('(records) => sharpforge.loadDiskRecords(records, {name:"Standalone design", mode:"folder"})', standalone)
            page.evaluate('sharpforge.designerDocuments.open("Board.sfdesign.json", "design")')
            document = page.evaluate('sharpforge.designerDocuments.get("Board.sfdesign.json")')
            truth(document['kind'] == 'design' and document['mode'] == 'design')
            truth(page.locator('[data-designer-document="Board.sfdesign.json"] .design-stage').count() == 1)
            truth(page.locator('[data-dock-tab="designer"]').count() == 0)

        checked('standalone design JSON opens as its own document without a retired designer tool panel', standalone_design_document)

        def close_removed_files():
            page.evaluate('sharpforge.loadDiskRecords([{path:"Program.cs",text:"class Program { static void Main() {} }"}],'
                          '{name:"Closed designers", mode:"folder"})')
            truth(page.evaluate('sharpforge.designerDocuments.list().documents.length') == 0)
            truth(page.locator('[data-designer-document]').count() == 0)

        checked('workspace file removal disposes document hosts and releases the session registry', close_removed_files)
        truth(not errors, '\n'.join(errors))
        REPORT.write_text(json.dumps({'passed': True, 'checks': checks,
                                      'reloadBackend': 'recovery-roundtrip' if os.getenv('SHARPFORGE_IN_MEMORY') == '1' else 'http-reload'}, indent=2))
except Exception as error:
    REPORT.write_text(json.dumps({'passed': False, 'checks': checks, 'error': str(error)}, indent=2))
    raise
