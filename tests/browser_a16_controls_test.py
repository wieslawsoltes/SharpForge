"""Full A16 host scope: real DOM/ARIA snapshots, native keyboard and drag APIs, B01-B05.

Run after the complete project scope and production build are ready. This suite
uses the repository browser/CSP harness. Its structural rule engine is explicitly
identified; no claim is made that it is axe-core or a native screen reader.
"""
from pathlib import Path
import json
import os
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
from browser_harness import load_application
from conformance.browser.launch import launch_browser, results_dir
from playwright.sync_api import sync_playwright
from a16_browser_managed import template_input, scrolling, expander, rich_overflow
from a16_browser_environment import text_scale_and_preferences, raster_scale, touch_density

RESULTS = results_dir() / 'a16-controls'
RESULTS.mkdir(parents=True, exist_ok=True)
INSTALL = (ROOT / 'tests/helpers/a16-browser-harness.js').read_text(encoding='utf8')
MANAGED = (ROOT / 'tests/helpers/a16-managed-browser.js').read_text(encoding='utf8')


def fixtures():
    script = r"""
import {familyCases,familyScene} from './tests/helpers/a16-family-scenes.js';
import * as scenes from './tests/helpers/a16-regression-scenes.js';
const buttons=[];
for(const type of ['Button','ToggleButton','AppBarButton','HyperlinkButton'])
 for(const height of [24,28,32,48]) for(const fontSize of [10,14,20])
  for(const content of ['string','element','template']) buttons.push({type,height,fontSize,content,
    scene:scenes.buttonAlignmentScene({type,height,fontSize,content})});
console.log(JSON.stringify({family:familyCases.map(testCase=>({testCase,scene:familyScene(testCase,{prefix:'gallery',width:320,height:220})})),
 buttons,vertical:scenes.alignmentScene(),horizontal:scenes.alignmentScene(true),border:scenes.borderScene(),
 shapes:['StackPanel','Grid','Canvas'].map(type=>({type,scene:scenes.shapeScene(type)})),
 radios:scenes.radioScene(),namedRadios:scenes.radioScene('radio',true),drag:scenes.dragScene(),
 rich:scenes.richOverflowScene(),rounded:scenes.roundedGridScene()}));
"""
    return json.loads(subprocess.check_output(['node', '--input-type=module', '-e', script], cwd=ROOT, text=True))


def require(value, message):
    if not value:
        raise AssertionError(message)


def install(page):
    load_application(page)
    page.evaluate('(' + INSTALL + ')()')
    page.evaluate('(' + MANAGED + ')()')


def mount(page, scene, **options):
    return page.evaluate('(v)=>a16.mount(v.scene,v.options)', {'scene': scene, 'options': options})


def assert_audit(value, label):
    for name in ('structural', 'dom'):
        require(not value[name]['violations'], label + ': ' + json.dumps(value[name]['violations']))
    require(not value['errors'], label + ': ' + json.dumps(value['errors']))


def reaches_control(page, target, limit=80):
    page.locator('[data-a16-before="main"]').focus()
    visited = []
    for _ in range(limit):
        page.keyboard.press('Tab')
        active = page.evaluate('''()=>({id:document.activeElement?.closest('[data-sf-id]')?.dataset.sfId,
          proxy:document.activeElement?.dataset.sfProxyId,focused:a16.records.get('main').host.focusManager.focusedElement})''')
        visited.append(active)
        if target in active.values():
            return visited
    raise AssertionError('Control not reachable by native Tab: ' + target + '; ' + repr(visited))


def run():
    data = fixtures()
    results = {'ruleEngines': ['sharpforge-structural-a11y', 'sharpforge-dom-a11y'], 'gallery': [], 'regressions': [], 'keyboard': []}
    with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
        page = browser.new_page(viewport={'width': 1200, 'height': 900}, device_scale_factor=1)
        install(page)
        gpu = page.evaluate('async()=>!!(navigator.gpu && await navigator.gpu.requestAdapter())')
        results['webgpuAvailable'] = gpu
        try:
            gallery(page, data['family'], results, gpu)
            button_alignment(page, data['buttons'], results)
            geometry_regressions(page, data, results)
            radio_regressions(page, data, results)
            keyboard_actions(page, data['family'], results)
            drag_regressions(page, data['drag'], results)
            template_input(page, results)
            scrolling(page, results)
            expander(page, results)
            rich_overflow(page, data['rich'], results)
            media = (ROOT / 'tests/helpers/a16-family-media-browser.js').read_text(encoding='utf8')
            results['media'] = page.evaluate('(' + media + ')()')
            commands = (ROOT / 'tests/helpers/a16-family-command-browser.js').read_text(encoding='utf8')
            results['commands'] = page.evaluate('(' + commands + ')()')
            overlays = (ROOT / 'tests/helpers/a16-family-overlay-browser.js').read_text(encoding='utf8')
            results['overlays'] = page.evaluate('(' + overlays + ')()')
            text_scale_and_preferences(page, results)
            raster_scale(browser, install, data['rounded'], results)
            touch_density(browser, install, results)
            page.screenshot(path=str(RESULTS / 'a16-final.png'))
            results['passed'] = True
        except Exception:
            results['passed'] = False
            results['hostErrors'] = page.evaluate('a16.errors')
            page.screenshot(path=str(RESULTS / 'a16-failure.png'))
            raise
        finally:
            (RESULTS / 'results.json').write_text(json.dumps(results, indent=2) + '\n', encoding='utf8')
            page.evaluate('a16.dispose()')
    print(json.dumps({'passed': True, 'gallery': len(results['gallery']), 'regressions': len(results['regressions']),
                      'keyboard': len(results['keyboard']), 'webgpuAvailable': gpu}))


def gallery(page, cases, results, gpu):
    for entry in cases:
        case = entry['testCase']
        name = case['type']
        scene = entry['scene']
        scene['nodes'][1]['properties']['AutomationProperties.Name'] = 'A16 ' + name
        unsupported = case.get('unsupported') and name != 'AnimatedVisualPlayer'
        if unsupported:
            error = None
            try:
                mount(page, scene)
            except Exception as failure:
                error = str(failure)
            require(error, name + ' must reject absent platform capability')
            results['gallery'].append({'type': name, 'capabilityRequired': True, 'error': error[:600]})
            continue
        baseline = None
        for backend in ['dom', 'canvas2d'] + (['webgpu'] if gpu else []):
            value = mount(page, scene, backend=backend, privateValue=case.get('privateValue'))
            assert_audit(value, name + '/' + backend)
            actual = page.locator('[data-a16-root="main"]').aria_snapshot()
            normalized = re.sub(r'\s+\[active\]', '', actual)
            if baseline is None:
                baseline = normalized
                (RESULTS / (name.replace('.', '_') + '.aria.yml')).write_text(actual, encoding='utf8')
            else:
                require(normalized == baseline, name + '/' + backend + ' actual accessibility tree differs from DOM:\n' + actual)
            focusable = next(item for item in value['controls'] if item['id'] == 'gallery:control')
            if focusable['focusable'] and not focusable['offscreen']:
                visits = reaches_control(page, 'gallery:control')
                results['keyboard'].append({'type': name, 'backend': backend, 'tabSteps': len(visits)})
            serialized = page.evaluate('JSON.stringify(a16.hostState())')
            if case.get('privateValue'):
                require(case['privateValue'] not in serialized and case['privateValue'] not in actual, 'Password leaked into public state')
            results['gallery'].append({'type': name, 'backend': backend, 'nodes': value['structural']['nodes'],
                                       'criticalViolations': 0, 'actualAriaSnapshot': True})


def button_alignment(page, buttons, results):
    for sample in buttons:
        mount(page, sample['scene'])
        value = page.evaluate("a16.textGeometry('button')")
        require(value['textHeight'] > 0, 'Button text has no actual DOM extent')
        require(value['difference'] <= 1.1, 'B01 misaligned text: ' + json.dumps({**sample, 'scene': None, 'geometry': value}))
    # CSS zoom changes actual browser boxes while managed layout stays in DIPs.
    sample = buttons[0]
    for zoom in [0.5, 0.8, 1, 2]:
        mount(page, sample['scene'])
        page.evaluate('z=>a16.records.get("main").root.style.zoom=String(z)', zoom)
        value = page.evaluate("a16.textGeometry('button')")
        require(value['difference'] <= max(1.1, zoom), 'B01 zoom misalignment: ' + str(zoom))
    results['regressions'].append({'issue': 1735, 'cases': len(buttons) + 4, 'actualDOMRange': True})


def geometry_regressions(page, data, results):
    for key, axis, extent in [('vertical', 'x', 240), ('horizontal', 'y', 200)]:
        mount(page, data[key])
        parent = page.evaluate("a16.geometry('panel')")
        for index, name in enumerate(['start', 'center', 'end', 'stretch']):
            child = page.evaluate('id=>a16.geometry(id)', name)
            expected = [0, (extent - 40) / 2, extent - 40, 0][index]
            require(abs(child[axis] - parent[axis] - expected) <= 1, 'B02 wrong cross-axis slot: ' + key + '/' + name)
    results['regressions'].append({'issue': 1736, 'axes': 2})
    mount(page, data['border'])
    default = page.evaluate("a16.geometry('default').css")
    explicit = page.evaluate("a16.geometry('explicit').css")
    require(default['borderWidth'] == '1px' and default['border'] not in ['transparent', 'rgba(0, 0, 0, 0)'], 'B03 transparent default border')
    require(default['border'] != explicit['border'], 'B03 explicit BorderBrush was ignored')
    results['regressions'].append({'issue': 1737, 'default': default, 'explicit': explicit})
    for sample in data['shapes']:
        mount(page, sample['scene'])
        first = page.evaluate("a16.geometry('one').layout")
        second = page.evaluate("a16.geometry('two').layout")
        if sample['type'] == 'StackPanel':
            require(first['x'] == 0 and first['y'] == 0 and second['y'] == 30, 'B04 shapes did not occupy StackPanel slots')
        elif sample['type'] == 'Grid':
            require(first['x'] == 100 and first['y'] == 150, 'B04 shape Grid alignment was lost')
        else:
            require(first['x'] == 70 and first['y'] == 80, 'B04 Canvas attached coordinates were lost')
    results['regressions'].append({'issue': 1738, 'parents': 3})


def click_node(page, node_id, key='main'):
    page.locator('[data-a16-root="' + key + '"] [data-sf-id="' + node_id + '"]').click()


def checked(page, key='main'):
    return page.evaluate('key=>Object.fromEntries(a16.hostState(key).nodes.filter(n=>n.id.startsWith("radio:")).map(n=>[n.id,n.properties.IsChecked]))', key)


def radio_regressions(page, data, results):
    mount(page, data['radios'])
    click_node(page, 'radio:a'); click_node(page, 'radio:c')
    state = checked(page)
    require(state['radio:a'] and state['radio:c'], 'B05 unnamed radio groups crossed parents')
    click_node(page, 'radio:b')
    state = checked(page)
    require(not state['radio:a'] and state['radio:b'] and state['radio:c'], 'B05 sibling group did not remain independent')
    mount(page, data['namedRadios'])
    click_node(page, 'radio:a'); click_node(page, 'radio:c')
    state = checked(page)
    require(not state['radio:a'] and state['radio:c'], 'B05 named radio group did not span its XamlRoot')
    mount(page, data['namedRadios'], key='second', append=True)
    click_node(page, 'radio:a', 'second')
    require(checked(page)['radio:c'] and checked(page, 'second')['radio:a'], 'B05 named groups leaked between applications')
    results['regressions'].append({'issue': 1739, 'scopes': ['parent', 'XamlRoot', 'independent hosts']})


def keyboard_actions(page, family, results):
    cases = {entry['testCase']['type']: entry for entry in family}
    for name, key, property in [('Button', 'Enter', None), ('CheckBox', 'Space', 'IsChecked'),
                               ('ToggleSwitch', 'Space', 'IsOn'), ('Slider', 'ArrowRight', 'Value'),
                               ('NumberBox', 'ArrowUp', 'Value'), ('ListView', 'ArrowDown', 'SelectedIndex')]:
        entry = cases[name]
        if name == 'Button' and 'Click' not in entry['scene']['nodes'][1]['events']:
            entry['scene']['nodes'][1]['events'].append('Click')
        mount(page, entry['scene'])
        reaches_control(page, 'gallery:control')
        before = page.evaluate('a16.hostState()')
        page.keyboard.press(key)
        page.evaluate('a16.records.get("main").host.settled()')
        after = page.evaluate('a16.hostState()')
        if property:
            first = next(node['properties'].get(property) for node in before['nodes'] if node['id'] == 'gallery:control')
            last = next(node['properties'].get(property) for node in after['nodes'] if node['id'] == 'gallery:control')
            require(last != first, name + ' keyboard action did not change ' + property)
        else:
            require(sum(event['name'] == 'Click' for event in after['events']) == 1, 'Button Enter must invoke once')
        results['keyboard'].append({'type': name, 'action': key, 'stateChanged': True})


def drag_regressions(page, scene, results):
    mount(page, scene)
    page.evaluate('a16.installDrag()')
    result = page.evaluate('a16.nativeDrop()')
    require(result['text'] == 'native browser drag' and result['dropEffect'] == 'copy', 'Typed browser drag lost text/operation')
    require(any(event['name'] == 'ObservedDrop' for event in result['state']['events']), 'Drop target did not receive data')
    policy = page.evaluate('a16.fileDropPolicy()')
    require(policy['before'] == 0 and policy['reads'] == 1 and policy['permissionCalls'] == 2, 'File adapter bypassed permission')
    require(not policy['sceneHasContents'], 'File contents escaped into public scene')
    results['regressions'].append({'scope': 'A16-T04.8', 'nativeDataTransfer': True, 'filePolicy': policy})


if __name__ == '__main__':
    run()
