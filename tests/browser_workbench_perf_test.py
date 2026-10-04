"""Measured 500-file workspace qualification with absolute and optional relative p95 budgets."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_harness import load_application, wait_condition
from conformance.browser.launch import launch_browser, results_dir


def percentile(values, fraction):
    import math
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)]


def run():
    with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        load_application(page)
        wait_condition(page, '!!sharpforge.workbenchShell')
        startup = page.evaluate('performance.now()')
        page.evaluate("""async () => {
          for (let turn = 0; turn < 5; turn++) {
            for (const dialog of [...sharpforge.workbenchShell.dialogs.stack]) dialog.cancel();
            await Promise.resolve();
          }
        }""")
        records = [{'path': 'Perf.csproj', 'text': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
                    '<OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>'},
                   {'path': 'Program.cs', 'text': 'using System; class Program { static void Main() { Console.WriteLine(42); } }'}]
        records.extend({'path': f'Types/Type{index}.cs', 'text': f'class Type{index} {{ public int Value {{ get; set; }} }}'}
                       for index in range(500))
        page.evaluate('records => sharpforge.loadDiskRecords(records, {name: "WorkbenchPerf"})', records)
        values = page.evaluate("""async () => {
          const shell = sharpforge.workbenchShell;
          const samples = [{name: 'startup', sessionId: 'workbench', duration: performance.now()}];
          for (let pass = 0; pass < 20; pass++) {
            let start = performance.now();
            await shell.navigate({uri: 'Types/Type' + pass + '.cs'});
            await new Promise(requestAnimationFrame);
            samples.push({name: 'document-switch', sessionId: 'workbench', duration: performance.now() - start});
          }
          for (const id of ['problems', 'output', 'object-browser', 'command-window', 'bookmarks']) {
            for (let pass = 0; pass < 4; pass++) {
              const start = performance.now();
              await shell.activateTool(id);
              await new Promise(requestAnimationFrame);
              samples.push({name: 'tool-activation', sessionId: 'workbench', duration: performance.now() - start,
                metadata: {tool: id, cold: pass === 0}});
            }
          }
          return samples;
        }""")
        values[0]['duration'] = startup
        summary = []
        budgets = {'startup': 10000, 'document-switch': 250, 'tool-activation': 1500}
        baseline_path = os.getenv('SHARPFORGE_WORKBENCH_BASELINE')
        baseline = json.loads(Path(baseline_path).read_text(encoding='utf8')) if baseline_path else {'summary': []}
        failures = []
        for name in budgets:
            durations = [sample['duration'] for sample in values if sample['name'] == name]
            metric = {'name': name, 'sessionId': 'workbench', 'count': len(durations),
                      'p50': percentile(durations, .5), 'p95': percentile(durations, .95), 'p99': percentile(durations, .99)}
            summary.append(metric)
            previous = next((item for item in baseline['summary'] if item['name'] == name and item['sessionId'] == 'workbench'), None)
            limit = min(budgets[name], previous['p95'] * 1.2) if previous else budgets[name]
            if metric['p95'] > limit:
                failures.append({**metric, 'limit': limit})
        trace = {'format': 'sharpforge-workbench-trace', 'version': 1, 'units': 'milliseconds',
                 'fixture': {'sourceFiles': 501, 'projectFiles': 1}, 'summary': summary, 'samples': values,
                 'relativeBaseline': baseline_path, 'failures': failures, 'browserErrors': errors}
        (results_dir() / 'workbench-large-trace.json').write_text(json.dumps(trace, indent=2), encoding='utf8')
        print(json.dumps({'summary': summary, 'failures': failures}, indent=2))
        if failures or errors:
            raise AssertionError('Workbench performance qualification failed: ' + repr(failures or errors))


if __name__ == '__main__':
    run()
