"""Real Chromium explorer row identity, transaction undo/redo, OPFS and two-window revision lifecycle."""
import json
from playwright.sync_api import sync_playwright
from browser_harness import load_application
from conformance.browser.launch import launch_browser, results_dir


def main():
    checks = []
    report = {'passed': False, 'checks': checks, 'qualification': 'Production HTTP/CSP, Chromium, actual OPFS and BroadcastChannel'}
    try:
        with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
            context = browser.new_context(viewport={'width': 1500, 'height': 950})
            first = context.new_page()
            errors = []
            first.on('pageerror', lambda error: errors.append(str(error)))
            load_application(first)
            url = first.url
            second = context.new_page()
            second.on('pageerror', lambda error: errors.append(str(error)))
            second.goto(url)
            second.wait_for_function('window.sharpforge && sharpforge.getState().metrics !== null')
            setup = """async () => {
              const {FileSystemAccessProvider} = await __sharpforgeTestImport('/packages/workspace/src/index.js');
              const {readProviderDirectory: readDirectory} = await __sharpforgeTestImport('/packages/project-system/src/index.js');
              const root = await navigator.storage.getDirectory();
              const handle = await root.getDirectoryHandle('a24-integrity-physical-folder', {create:true});
              const provider = new FileSystemAccessProvider(handle);
              await provider.createDirectory('App/Assets', {recursive:true});
              const records = [
                {path:'App/App.csproj',text:'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'+
                  '<TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>'},
                {path:'App/A.cs',text:'class A { public int Value => 1; }'},
                {path:'App/Assets/raw.bin',bytes:Uint8Array.of(0,128,255)}
              ];
              for (const record of records) await provider.writeFile(record.path, record.bytes ?? new TextEncoder().encode(record.text));
              const disk = await readDirectory(handle);
              window.__a24IntegrityDisk = disk;
              await sharpforge.loadDiskRecords(disk.records,
                {entry:'App/App.csproj', name:'IntegrityBrowser', disk, folders:disk.folders});
            }"""
            first.evaluate(setup)
            second.evaluate(setup)
            for page in (first, second):
                page.wait_for_function('sharpforge.getState().files.some(file => file.uri === "App/A.cs")')
                page.evaluate('sharpforge.explorerCommand("open", "App/A.cs", "source")')
            row = first.locator('[data-tree-id][data-file="App/A.cs"]')
            row.click()
            first.evaluate('window.__retainedExplorerRow = document.querySelector(\'[data-tree-id][data-file="App/A.cs"]\')')
            first.evaluate('sharpforge.explorerCommand("refresh")')
            assert first.evaluate('window.__retainedExplorerRow === document.querySelector(\'[data-tree-id][data-file="App/A.cs"]\')')
            checks.append('refresh preserves clicked row element and focus identity')

            first.evaluate('void sharpforge.explorerCommand("rename", "App/A.cs", "source")')
            first.locator('#item-path').fill('App/Renamed.cs')
            first.get_by_role('button', name='Apply', exact=True).click()
            first.wait_for_function('document.querySelector("#modal-title")?.textContent === "Rename matching type?" || '
                'sharpforge.getState().files.some(file => file.uri === "App/Renamed.cs")')
            if first.get_by_role('heading', name='Rename matching type?', exact=True).is_visible():
                first.get_by_role('button', name='Cancel', exact=True).click()
            first.wait_for_function('!sharpforge.getExplorer().busy && sharpforge.getState().files.some(file => file.uri === "App/Renamed.cs")')
            assert first.evaluate('async () => new TextDecoder().decode(await __a24IntegrityDisk.provider.readFile("App/Renamed.cs"))') == \
                'class A { public int Value => 1; }'
            selected = first.evaluate('sharpforge.getExplorer().selected')
            assert any('App/Renamed.cs' in identity for identity in selected), selected
            first.evaluate('sharpforge.explorerCommand("undo")')
            first.wait_for_function('!sharpforge.getExplorer().busy && sharpforge.getState().files.some(file => file.uri === "App/A.cs")')
            assert first.evaluate('async () => new TextDecoder().decode(await __a24IntegrityDisk.provider.readFile("App/A.cs"))') == \
                'class A { public int Value => 1; }'
            first.evaluate('sharpforge.explorerCommand("redo")')
            first.wait_for_function('!sharpforge.getExplorer().busy && sharpforge.getState().files.some(file => file.uri === "App/Renamed.cs")')
            first.evaluate('sharpforge.explorerCommand("undo")')
            checks.append('rename keeps selection; undo and redo restore physical provider bytes and project membership')

            first.wait_for_timeout(1000)
            recovered = first.evaluate("""async () => {
              const {OpfsRecoveryStore} = await __sharpforgeTestImport('/packages/workspace/src/index.js');
              const root = await navigator.storage.getDirectory();
              for await (const [name, directory] of root.entries()) {
                if (!name.startsWith('sharpforge-workspace-')) continue;
                for await (const [windowName, windowDirectory] of directory.entries()) {
                  if (!windowName.startsWith('window-')) continue;
                  const result = await new OpfsRecoveryStore({directory:windowDirectory}).load();
                  const asset = result.record?.records.find(file => file.path === 'App/Assets/raw.bin');
                  if (asset) return [...asset.bytes];
                }
              }
              return null;
            }""")
            assert recovered == [0, 128, 255], recovered
            checks.append('actual OPFS explorer checkpoint retains exact binary bytes')

            first.evaluate('sharpforge.explorerCommand("open", "App/A.cs", "source")')
            first.locator('[data-source-uri="App/A.cs"] .sf-input').fill('class A { public int Value => 2; }')
            second.wait_for_function('document.querySelector(".explorer-caption").textContent.includes("document conflicts")', timeout=15000)
            assert 'Value => 1' in second.locator('[data-source-uri="App/A.cs"] .sf-input').input_value()
            checks.append('two production windows detect divergent revisions without overwriting the other buffer')
            assert not errors, errors
            report['browserVersion'] = browser.version
        report['passed'] = True
    except Exception as error:
        report['failure'] = str(error)
        raise
    finally:
        target = results_dir() / 'a24-integrity-browser-results.json'
        target.write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
