"""Local served Studio adapter. Stdout is the bounded acceptance RPC channel."""
import contextlib
import json
import os
from pathlib import Path
import sys
import traceback

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tests'))
from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser
from browser_harness import load_application, wait_condition

OUTPUT = Path(sys.argv[1]).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
RPC = sys.stdout


def check(value, message):
    if not value:
        raise AssertionError(message)


def dispatch(page, step):
    action = step['action']
    if action in ('open', 'designer-create'):
        directory = ROOT / 'tests/conformance/acceptance/fixtures' / step['fixture']
        records = [{'path': str(p.relative_to(directory)).replace(os.sep, '/'), 'text': p.read_text()}
                   for p in sorted(directory.rglob('*')) if p.is_file()]
        page.evaluate('() => sharpforge.execute("stop")')
        page.evaluate('records => sharpforge.loadDiskRecords(records, {name:"Acceptance"})', records)
        if action == 'open':
            page.evaluate('path => sharpforge.setStartupProject(path)', step['startup'])
            check(len(page.evaluate('sharpforge.getState().project.projects')) == 3, 'Expected three projects')
        return page.evaluate('sharpforge.getState()')
    if action == 'edit':
        page.evaluate('path => sharpforge.openFile(path)', step['path'])
        editor = page.locator('[data-source-uri=' + json.dumps(step['path']) + '] .sf-input')
        text = editor.input_value()
        check(text.count(step['find']) == 1, 'Edit must match exactly once')
        editor.fill(text.replace(step['find'], step['replace']))
        return {'path': step['path']}
    if action == 'build':
        page.evaluate('() => sharpforge.build()')
        state = page.evaluate('sharpforge.getState()')
        check(not [d for d in state['diagnostics'] if d['severity'] == 'error'], str(state['diagnostics']))
        check(state['artifact'] and state['artifact']['bytes'] > 128, 'No actual PE artifact')
        return state
    if action == 'breakpoints':
        for point in step['points']:
            page.evaluate('p => sharpforge.setBreakpoints(p.path,[{line:p.line}])', point)
        return page.evaluate('sharpforge.getBreakpoints()')
    if action in ('debug', 'step', 'continue'):
        before = page.evaluate('sharpforge.getState().debug?.stats?.instructions ?? -1')
        if action == 'debug':
            page.evaluate('() => sharpforge.debug({stopOnEntry:false})')
        else:
            page.evaluate('mode => sharpforge.step(mode)', step.get('kind', 'continue'))
        if 'output' in step:
            wait_condition(page, 'sharpforge.getState().debug?.state === "terminated"')
        else:
            wait_condition(page, '(before => {const d=sharpforge.getState().debug;return d?.state === "paused" && d.stats.instructions !== before;})(' + str(before) + ')')
        state = page.evaluate('sharpforge.getState().debug')
        check(not state.get('fault'), str(state.get('fault')))
        if 'path' in step:
            check(state['frames'][0]['source'] == step['path'], str(state['frames']))
        if 'line' in step:
            check(state['frames'][0]['line'] == step['line'], str(state['frames']))
        if 'output' in step:
            check(state['output'].strip() == step['output'], state['output'])
        return state
    if action == 'inspect':
        result = page.evaluate('expression => sharpforge.evaluate(expression)', step['expression'])
        check(result['result'] == step['equals'], str(result))
        return result
    if action == 'designer-connect':
        page.evaluate('() => sharpforge.designer.open()')
        page.evaluate('path => sharpforge.designer.connect(path)', step['path'])
        wait_condition(page, 'sharpforge.designer.get().sourceSync.state === "synced"')
        return page.evaluate('sharpforge.designer.get()')
    if action == 'designer-edit':
        page.evaluate('s => sharpforge.designer.set(s.property,s.value,[s.node])', step)
        wait_condition(page, 'sharpforge.designer.get().sourceSync.state === "synced"')
        return page.evaluate('sharpforge.designer.get()')
    if action == 'source-contains':
        text = page.evaluate('path => sharpforge.getState().files.find(f=>f.uri===path).text', step['path'])
        check(step['contains'] in text, text)
        (OUTPUT / (step['id'] + '.cs')).write_text(text)
        return {'source': step['id'] + '.cs'}
    if action == 'run':
        page.evaluate('() => sharpforge.run()')
        wait_condition(page, 'sharpforge.getState().debug?.uiActive === true')
        return page.evaluate('sharpforge.getState().debug')
    if action == 'designer-attach':
        page.evaluate('() => sharpforge.designer.attach()')
        return page.evaluate('sharpforge.designer.get()')
    if action == 'designer-live':
        page.evaluate('s => {const d=sharpforge.designer.get().document;const n=d.nodes.find(n=>n.properties.Name===s.name);if(!n)throw Error("Missing design node");sharpforge.designer.set(s.property,s.value,[n.id]);}', step)
        return page.evaluate('() => sharpforge.designer.apply()')
    if action == 'scene':
        scene = page.evaluate('() => sharpforge.getUIScene()')
        nodes = [n for n in scene['nodes'] if n.get('properties', {}).get('Name') == step['name']]
        check(len(nodes) == 1, str(scene))
        check(nodes[0]['properties'].get(step['property']) == step['value'], str(nodes[0]))
        return scene
    raise ValueError('Studio action unavailable: ' + action)


def main(dispatch_step=dispatch):
    with contextlib.redirect_stdout(sys.stderr), sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.set_default_timeout(15000)
        page.on('dialog', lambda dialog: dialog.accept())
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        load_application(page)
        for line in sys.stdin:
            request = json.loads(line)
            try:
                if request['command'] == 'close':
                    page.evaluate('() => sharpforge.execute("stop")')
                    RPC.write(json.dumps({'id': request['id'], 'result': {'closed': True}}) + '\n')
                    RPC.flush()
                    return
                step = request['args']
                result = dispatch_step(page, step)
                check(not errors, str(errors))
                page.screenshot(path=str(OUTPUT / (step['id'] + '.png')))
                response = {'id': request['id'], 'result': {'value': result, 'browser': browser.version, 'screenshot': step['id'] + '.png'}}
            except Exception as error:
                traceback.print_exc(file=sys.stderr)
                try:
                    page.screenshot(path=str(OUTPUT / 'failure.png'))
                except Exception:
                    pass
                response = {'id': request['id'], 'error': str(error)}
            RPC.write(json.dumps(response) + '\n')
            RPC.flush()


if __name__ == '__main__':
    main()
