"""Defensive Studio text-rendering fixtures over actual production HTTP/CSP.

No provider, remote endpoint, native SDK, generated app or physical browser pass
is inferred. Marker payloads can only set a local test flag if incorrectly used
as markup; they contain no external URL or data transfer.
"""
import html
import json
import re
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tests'))
from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir
from browser_harness import load_application, wait_condition

OUTPUT = results_dir()
MARKUP = 'XSS_PROBE <svg data-sf-xss-probe onload="globalThis.__sfXssExecuted=1">'
PANELS = re.findall(r"\['([^']+)','[^']+'\]", (ROOT / 'apps/studio/tools/definitions.js').read_text(encoding='utf8'))
if not PANELS or len(set(PANELS)) != len(PANELS):
    raise RuntimeError('Cannot enumerate the complete registered Studio panel catalogue')


def assert_safe(page, violations, errors):
    observed = page.evaluate('''() => ({
      marker:globalThis.__sfXssExecuted??0,
      injected:document.querySelectorAll('[data-sf-xss-probe]').length,
      handlers:[...document.querySelectorAll('*')].flatMap(element=>[...element.attributes]
        .filter(attribute=>/^on/i.test(attribute.name)&&attribute.value.includes('__sfXssExecuted'))
        .map(attribute=>({tag:element.tagName,name:attribute.name,value:attribute.value}))),
      csp:globalThis.__sfCspViolations??[]
    })''')
    assert observed['marker'] == 0, 'An injected handler executed'
    assert observed['injected'] == 0, 'Injected markup entered the DOM'
    assert not observed['handlers'], str(observed['handlers'])
    assert not observed['csp'], str(observed['csp'])
    assert not violations, str(violations)
    assert not errors, str(errors)
    return observed


def panels(page, phase, report, violations, errors):
    for panel in PANELS:
        row = {'phase': phase, 'panel': panel, 'status': 'running'}
        report['panels'].append(row)
        try:
            page.evaluate('id => sharpforge.openTool(id)', panel)
            page.locator('[data-tool=' + json.dumps(panel) + ']').wait_for(state='attached')
            assert_safe(page, violations, errors)
            row['status'] = 'passed'
        except Exception as error:
            row['status'] = 'failed'
            row['error'] = str(error)
            page.screenshot(path=str(OUTPUT / 'studio-xss-failure.png'))
            raise


def fixture(page, payload, index):
    filename = 'Probe & <tag data-sf-xss-probe>.cs' if index else 'Plain.cs'
    source = 'using System; class P { static void Main(){Console.WriteLine(' + json.dumps(payload) + ');} }'
    project = ('<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework>'
               '<OutputType>Exe</OutputType><AssemblyName>' + html.escape(payload or 'Empty', quote=True) +
               '</AssemblyName><Description>' + html.escape(payload, quote=True) + '</Description></PropertyGroup></Project>')
    records = [{'path': filename, 'text': source}, {'path': 'Probe.csproj', 'text': project}]
    page.evaluate('() => sharpforge.execute("stop")')
    page.evaluate('value => sharpforge.loadDiskRecords(value.records,{name:value.name})', {'records': records, 'name': payload})
    page.evaluate('() => sharpforge.setStartupProject("Probe.csproj")')
    page.evaluate('path => sharpforge.openFile(path)', filename)
    state = page.evaluate('sharpforge.getState()')
    assert any(row['uri'] == filename for row in state['files']), 'Markup-bearing filename was not exercised'
    assert payload in json.dumps(state['project'], ensure_ascii=False), 'Project metadata was not loaded'
    page.evaluate('() => sharpforge.run()')
    wait_condition(page, 'sharpforge.getState().debug?.state === "terminated"')
    debug = page.evaluate('sharpforge.getState().debug')
    assert not debug['fault'], str(debug['fault'])
    assert debug['output'] == payload + '\n', 'Program output was not exercised'
    return filename


def main():
    report = {'schemaVersion': 1, 'status': 'running', 'scope': 'Real served Studio text rendering; managed Chromium only',
              'panels': [], 'inputs': [], 'cspViolations': [], 'pageErrors': [],
              'unqualified': ['Firefox', 'WebKit', 'physical mobile', 'native SDK', 'provider auth', 'application HTML export']}
    with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.on('dialog', lambda dialog: dialog.accept())
        page.on('pageerror', lambda error: report['pageErrors'].append(str(error)))
        page.on('console', lambda message: report['cspViolations'].append(message.text)
                if message.type == 'error' and ('Content Security Policy' in message.text or 'content-security-policy' in message.text) else None)
        page.add_init_script('''globalThis.__sfXssExecuted=0;globalThis.__sfCspViolations=[];
          addEventListener('securitypolicyviolation',event=>__sfCspViolations.push({
            directive:event.effectiveDirective,blockedURI:event.blockedURI,disposition:event.disposition}));''')
        try:
            load_application(page)
            for index, payload in enumerate(['plain & text', MARKUP, MARKUP + ' <>&"\'λ' * 128]):
                filename = fixture(page, payload, index)
                report['inputs'].append({'filename': filename, 'characters': len(payload), 'channels': ['filename', 'project metadata', 'program output', 'diagnostics']})
                panels(page, f'output-{index}', report, report['cspViolations'], report['pageErrors'])
                page.evaluate('path => sharpforge.openFile(path)', filename)
                editor = page.locator('[data-source-uri=' + json.dumps(filename) + '] .sf-input')
                editor.fill('#error ' + payload + '\nclass P { static void Main(){} }')
                page.evaluate('() => sharpforge.build()')
                diagnostics = page.evaluate('sharpforge.getState().diagnostics')
                assert any(payload in row['message'] for row in diagnostics), 'Markup-bearing diagnostic was not produced'
                panels(page, f'diagnostics-{index}', report, report['cspViolations'], report['pageErrors'])
            assert_safe(page, report['cspViolations'], report['pageErrors'])
            report['status'] = 'passed'
            report['browser'] = browser.version
            report['registeredPanels'] = PANELS
            page.screenshot(path=str(OUTPUT / 'studio-xss-passed.png'))
        except Exception as error:
            report['status'] = 'failed'
            report['error'] = str(error)
            traceback.print_exc()
            page.screenshot(path=str(OUTPUT / 'studio-xss-failure.png'))
            raise
        finally:
            page.evaluate('() => sharpforge.execute("stop")')
            report['cspEvents'] = page.evaluate('globalThis.__sfCspViolations??[]')
            (OUTPUT / 'studio-xss-results.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')


if __name__ == '__main__':
    main()
