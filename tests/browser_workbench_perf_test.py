"""Three independent app/workspace captures; relative comparison requires a compatible prior trace."""
import hashlib
import json
import math
import os
import platform
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_harness import load_application, wait_condition
from conformance.browser.launch import launch_browser, results_dir

ROOT = Path(__file__).resolve().parents[1]
VIEWPORT = {'width': 1440, 'height': 1000}
TOOLS = ['problems', 'output', 'object-browser', 'command-window', 'bookmarks']
NAMES = ['cold-app-startup', 'workspace-startup', 'document-switch', 'tool-activation']


def workspace_fixture():
    records = [{'path': 'Perf.csproj', 'text': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
                '<OutputType>Exe</OutputType></PropertyGroup></Project>'},
               {'path': 'Program.cs', 'text': 'using System; class Program { static void Main() { Console.WriteLine(42); } }'}]
    records.extend({'path': f'Types/Type{index}.cs', 'text': f'class Type{index} {{ public int Value {{ get; set; }} }}'}
                   for index in range(500))
    digest = hashlib.sha256(json.dumps(records, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()
    fixture = {'id': 'workbench-501-csharp-v2', 'sha256': digest, 'sourceFiles': 501, 'projectFiles': 1,
               'rounds': 3, 'documentSwitches': 20, 'tools': TOOLS, 'toolPasses': 4}
    return records, fixture


def capture_environment(page, browser):
    measured = page.evaluate('''() => ({deviceScaleFactor: devicePixelRatio, hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory ?? null, platform: navigator.platform,
        appDocument: new URL(location.href).pathname})''')
    artifact = os.getenv('SHARPFORGE_BROWSER_VARIANT', 'static')
    mode = ('in-memory-' if os.getenv('SHARPFORGE_IN_MEMORY') == '1' else 'http-') + artifact
    return {**measured, 'engine': browser.engine, 'browserVersion': browser.version,
            'operatingSystem': platform.system() + ' ' + platform.release(), 'architecture': platform.machine(),
            'processor': platform.processor(), 'viewport': VIEWPORT, 'servingMode': mode,
            'timingProtocol': 'fresh-context-paint-v2', 'browserProcess': 'shared; fresh isolated context per round'}


def capture_round(browser, records, fixture, round_index, errors):
    # Fresh contexts have independent storage, document models, workers and tool instances.
    page = browser.new_page(viewport=VIEWPORT, device_scale_factor=1)
    page.on('pageerror', lambda error: errors.append({'round': round_index, 'message': str(error)}))
    load_application(page)
    wait_condition(page, '!!sharpforge.workbenchShell')
    cold_startup = page.evaluate('''async () => {
      for (let turn = 0; turn < 5; turn++) {
        for (const dialog of [...sharpforge.workbenchShell.dialogs.stack]) dialog.cancel();
        await Promise.resolve();
      }
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      return performance.now();
    }''')
    environment = capture_environment(page, browser)
    workspace_startup = page.evaluate('''async records => {
      const started = performance.now();
      await sharpforge.loadDiskRecords(records, {name: 'WorkbenchPerf'});
      const shell = sharpforge.workbenchShell;
      if (shell.documents.list().filter(file => file.uri.endsWith('.cs')).length !== 501) {
        throw new Error('The 501-source workspace was not fully loaded');
      }
      if (shell.services.builds.list().some(build => build.busy)) throw new Error('Workspace build is still running');
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      return performance.now() - started;
    }''', records)
    values = [{'name': name, 'sessionId': 'workbench', 'round': round_index, 'duration': duration}
              for name, duration in [('cold-app-startup', cold_startup), ('workspace-startup', workspace_startup)]]
    values.extend(page.evaluate('''async ({fixture, round}) => {
      const shell = sharpforge.workbenchShell;
      const samples = [];
      const painted = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); };
      for (let pass = 0; pass < fixture.documentSwitches; pass++) {
        const uri = 'Types/Type' + pass + '.cs';
        const start = performance.now();
        await shell.navigate({uri});
        await painted();
        if (shell.context().uri !== uri) throw new Error('Document switch did not finish: ' + uri);
        samples.push({name: 'document-switch', sessionId: 'workbench', round, duration: performance.now() - start,
          metadata: {uri, pass}});
      }
      for (const id of fixture.tools) {
        for (let pass = 0; pass < fixture.toolPasses; pass++) {
          const start = performance.now();
          await shell.activateTool(id);
          await painted();
          if (!shell.mounts.has(id) || !shell.isToolVisible(id)) throw new Error('Tool activation did not finish: ' + id);
          if (id === 'object-browser') {
            const host = shell.mounts.get(id).host;
            while (!host.querySelector('[role="treeitem"]') && performance.now() - start < 10000) await painted();
            if (!host.querySelector('[role="treeitem"]')) throw new Error('Framework metadata did not finish loading');
          }
          samples.push({name: 'tool-activation', sessionId: 'workbench', round, duration: performance.now() - start,
            metadata: {tool: id, pass, cold: pass === 0}});
        }
      }
      return samples;
    }''', {'fixture': fixture, 'round': round_index}))
    page.close()
    return values, environment


def summarize(samples):
    result = []
    for name in NAMES:
        values = sorted(sample['duration'] for sample in samples if sample['name'] == name)
        if not values:
            continue
        result.append({'name': name, 'sessionId': 'workbench', 'count': len(values),
                       **{key: values[math.ceil(len(values) * fraction) - 1]
                          for key, fraction in [('p50', .5), ('p95', .95), ('p99', .99)]}})
    return result


def assess_trace(path, baseline_path):
    command = ['node', str(ROOT / 'tests/workbench-perf-budget.mjs')]
    command.extend([str(path), baseline_path] if baseline_path else ['--capture', str(path)])
    result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', cwd=ROOT, check=False)
    if not result.stdout.strip():
        raise RuntimeError('Trace validation produced no assessment: ' + result.stderr)
    return result.returncode, json.loads(result.stdout)


def run():
    records, fixture = workspace_fixture()
    trace = {'format': 'sharpforge-workbench-trace', 'version': 2, 'units': 'milliseconds', 'captureStatus': 'incomplete',
             'fixture': fixture, 'samples': [], 'browserErrors': [], 'relativeBaseline': os.getenv('SHARPFORGE_WORKBENCH_BASELINE')}
    output = results_dir() / 'workbench-large-trace.json'
    try:
        with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
            for round_index in range(fixture['rounds']):
                samples, environment = capture_round(browser, records, fixture, round_index, trace['browserErrors'])
                if trace.get('environment', environment) != environment:
                    raise AssertionError('Performance capture environment changed between independent rounds')
                trace['environment'] = environment
                trace['samples'].extend(samples)
        trace['captureStatus'] = 'completed'
    except BaseException as error:
        trace['captureFailure'] = str(error)
        raise
    finally:
        trace['summary'] = summarize(trace['samples'])
        output.write_text(json.dumps(trace, indent=2, allow_nan=False), encoding='utf-8')
    status, trace['assessment'] = assess_trace(output, trace['relativeBaseline'])
    output.write_text(json.dumps(trace, indent=2, allow_nan=False), encoding='utf-8')
    print(json.dumps({'summary': trace['summary'], **trace['assessment']}, indent=2))
    if status:
        raise AssertionError('Workbench performance qualification failed: ' + repr(trace['assessment']))


if __name__ == '__main__':
    run()
