"""Real Studio workers, output channels, retained hosts and native browser frame acknowledgements."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_harness import load_application, wait_condition
from conformance.browser.launch import launch_browser, results_dir

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'tests/fixtures/bindings/phased-page.cs').read_text(encoding='utf8')


def require(value, message):
    if not value:
        raise AssertionError(message)


def run():
    evidence = {'version': 1, 'nativeRequestAnimationFrame': True, 'actualRuntimeWorker': True, 'engines': []}
    with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
        page = browser.new_page(viewport={'width': 1200, 'height': 900})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        load_application(page)
        wait_condition(page, '!!sharpforge.workbenchServices && !!sharpforge.applicationWindows')
        page.evaluate('''async source => {
          const services = sharpforge.workbenchServices;
          const built = await services.compiler.request('build', {files: [{uri: 'BindingPhases.cs', text: source}]});
          if (!built.success) throw new Error(JSON.stringify(built.diagnostics));
          window.a15BindingBuild = built;
        }''', SOURCE)
        try:
            for engine in ['source', 'reload', 'CIL']:
                identity = page.evaluate('''async engine => {
                  const services = sharpforge.workbenchServices, built = a15BindingBuild;
                  const session = services.sessions.create({projectId: services.builds.activeId, name: 'Bindings ' + engine, renderer: 'dom'});
                  const record = {session, engine, phases: [], frames: [], requests: new Set(), initialDeferredAbsent: null};
                  window.a15BindingCurrent = record;
                  const worker = session.worker.worker, original = worker.postMessage;
                  worker.postMessage = function(message, ...args) {
                    if (message.method === 'uiHostResponse' && record.requests.has(message.params.requestId) && message.params.result) {
                      record.frames.push({...message.params.result});
                    }
                    return original.call(this, message, ...args);
                  };
                  record.unsubscribe = session.subscribe(event => {
                    const panel = sharpforge.applicationWindows.panels.get(session.id);
                    if (event.type === 'uiHost' && event.event.event === 'uiHostRequest' && event.event.kind === 'bindingFrame') {
                      record.requests.add(event.event.requestId);
                      record.initialDeferredAbsent ??= ![...panel.host.nodes.values()].some(node => node.properties.Name === 'deferred');
                    }
                    if (event.type !== 'ui') return;
                    for (const command of event.commands) {
                      const name = panel.host.nodes.get(command.id)?.properties.Name;
                      if (command.op === 'set' && command.property === 'Text' && command.value === 'PhaseRoot' && /^phase[123]$/.test(name)) {
                        const frame = record.frames.at(-1);
                        record.phases.push({phase: Number(name.slice(-1)), frame: frame?.frame, time: frame?.time});
                      }
                    }
                  });
                  const executable = engine === 'source' ? {image: built.image, bindingAssembly: built.assembly}
                    : {assembly: built.assembly, managedIL: engine === 'CIL'};
                  await session.launch({...executable, debug: false, manualAnimations: true});
                  sharpforge.openTool('app:' + session.id);
                  return session.id;
                }''', engine)
                wait_condition(page, '''() => a15BindingCurrent.phases.length >= 3 || a15BindingCurrent.session.state === 'faulted' ''', timeout=30000)
                state = page.evaluate('''async () => {
                  const {session, phases, frames, initialDeferredAbsent} = a15BindingCurrent;
                  const scene = await session.request('uiScene');
                  return {state: session.state, fault: session.debug?.fault, phases, frames, initialDeferredAbsent,
                    deferredPresent: scene.nodes.some(node => node.properties.Name === 'deferred'),
                    bindingOutput: sharpforge.workbenchServices.output.read('bindings:' + session.id),
                    programOutput: session.programOutput};
                }''')
                require(state['state'] != 'faulted', f"{engine} worker faulted: {state.get('fault')}")
                require([entry['phase'] for entry in state['phases']] == [1, 2, 3], f"{engine} phases did not execute in ascending order")
                frames = [entry['frame'] for entry in state['phases']]
                require(all(isinstance(frame, int) for frame in frames) and frames[0] < frames[1] < frames[2],
                        f"{engine} phases reused a frame acknowledgement: {frames}")
                require(all(entry.get('version') == 1 and entry.get('time', -1) >= 0 for entry in state['frames']),
                        f"{engine} did not return actual host scheduler timestamps")
                require(state['initialDeferredAbsent'] is True and not state['deferredPresent'], f"{engine} constructed x:Load=False prematurely")
                require(any(row.get('code') == 'SFB003' and row.get('diagnostic', {}).get('path') == 'MissingTitle'
                            for row in state['bindingOutput']), f"{engine} binding failure is absent from Studio output")
                require(state['programOutput'] == 'ready\n', f"{engine} diagnostics polluted Console output")
                page.locator(f'[data-app-session="{identity}"]').get_by_role('button', name='Realize deferred element', exact=True).click()
                wait_condition(page, 'a15BindingCurrent.session.programOutput === "ready\\ndeferred\\n"')
                realized = page.evaluate('''async () => (await a15BindingCurrent.session.request('uiScene')).nodes.some(node =>
                  node.properties.Name === 'deferred' && node.properties.Text === 'realized later')''')
                require(realized, f"{engine} FindName did not materialize its deferred element")
                evidence['engines'].append({'engine': engine, 'phases': state['phases'], 'frames': state['frames'],
                                           'bindingOutput': True, 'deferredFindName': True})
                page.evaluate('''async () => {
                  const record = a15BindingCurrent; record.unsubscribe(); await record.session.stop();
                  sharpforge.workbenchServices.sessions.remove(record.session.id); window.a15BindingCurrent = null;
                }''')
            require(not errors, 'Browser errors: ' + repr(errors))
            evidence['passed'] = True
        finally:
            evidence['errors'] = errors
            (results_dir() / 'a15-binding-services.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf8')
            page.evaluate('''async () => {
              if (!window.a15BindingCurrent) return;
              a15BindingCurrent.unsubscribe(); await a15BindingCurrent.session.stop();
              sharpforge.workbenchServices.sessions.remove(a15BindingCurrent.session.id);
            }''')
    print(json.dumps(evidence, indent=2))


if __name__ == '__main__':
    run()
