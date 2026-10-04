"""Production wizard controls, ZIP64 streams and actual Chromium OPFS destination transactions."""
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
    page = browser.new_page(viewport={'width': 1500, 'height': 1100})
    page.set_default_timeout(15000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    load_application(page)

    def cancelled_picker():
        before = page.evaluate('sharpforge.getState().name')
        page.evaluate('''() => {
            window.showDirectoryPicker = async () => { throw new DOMException('Cancelled', 'AbortError'); };
            void sharpforge.openProjectWizard();
        }''')
        page.locator('[data-template="console"]').dblclick()
        page.locator('#wizard-destination').select_option('directory')
        truth(page.locator('#wizard-next').is_disabled())
        page.locator('#wizard-browse').click()
        page.wait_for_function('document.querySelector("#wizard-destination-status").textContent.includes("cancelled")')
        truth(page.locator('#wizard-next').is_disabled())
        truth(page.evaluate('sharpforge.getState().name') == before)
        truth(page.locator('#wizard-destination-path').inner_text() == 'No folder selected')
        truth(page.locator('#modal-backdrop').is_visible())
        page.locator('#wizard-cancel').click()

    check('Cancelling the real wizard picker flow keeps the wizard open and creation disabled', cancelled_picker)

    def native_prerequisites():
        page.evaluate('void sharpforge.openProjectWizard()')
        page.locator('[data-template="xunit"]').click()
        truth('native .NET toolchain' in page.locator('#wizard-description').inner_text())
        page.locator('[data-template="winui-native-packaged"]').click()
        truth('Requires Windows' in page.locator('#wizard-description').inner_text())
        page.locator('#wizard-cancel').click()

    check('Native test and Windows templates display their actual prerequisites', native_prerequisites)

    def option_flow():
        page.evaluate('void sharpforge.openProjectWizard()')
        page.locator('[data-template="console"]').dblclick()
        page.locator('#wizard-project-name').fill('UiOptions')
        page.locator('#wizard-solution-format').select_option('sln')
        page.locator('#wizard-same-directory').check()
        page.locator('.wizard-fields details summary').click()
        page.locator('#wizard-program-main').uncheck()
        page.locator('#wizard-implicit-usings').check()
        page.locator('#wizard-nullable').select_option('enable')
        truth(page.locator('#wizard-errors').inner_text() == '')
        page.locator('#wizard-next').click()
        page.wait_for_function('document.querySelector("#modal-backdrop").classList.contains("hidden")')
        result = page.evaluate('''() => {
            const records = sharpforge.getWorkspace().records;
            return { paths: records.map(record => record.path), program: records.find(record => record.path === 'Program.cs').text,
                project: records.find(record => record.path === 'UiOptions.csproj').text };
        }''')
        truth('UiOptions.sln' in result['paths'])
        truth(result['program'] == 'Console.WriteLine("Hello, world!");\n')
        truth('<Nullable>enable</Nullable>' in result['project'])
        page.evaluate('sharpforge.run()')
        page.wait_for_function('sharpforge.getState().debug?.state === "terminated"')
        truth(page.evaluate('sharpforge.getState().debug.output.trim()') == 'Hello, world!')
        page.evaluate('sharpforge.execute("stop")')

    check('Wizard options create a runnable top-level project and classic solution in the chosen layout', option_flow)

    def opfs_destination():
        result = page.evaluate('''async () => {
            const { commitWizardDirectory } = await window.__sharpforgeTestImport('/project-wizard/destination.js');
            const { writeNewDirectory } = await window.__sharpforgeTestImport('/packages/project-system/src/index.js');
            const root = await navigator.storage.getDirectory();
            const directory = await root.getDirectoryHandle('a24-template-destination', { create: true });
            try {
                const file = await directory.getFileHandle('original.bin', { create: true });
                const original = new Uint8Array([0, 255, 128, 13, 10]);
                const writer = await file.createWritable();
                await writer.write(original);
                await writer.close();
                const plan = { records: [{ path: 'original.bin', bytes: new Uint8Array([9, 8, 7]) },
                    { path: 'New/File.cs', text: 'class Created {}' }], folders: ['Empty'] };
                const declined = await commitWizardDirectory(directory, plan, { confirmOverwrite: () => false });
                const before = [...new Uint8Array(await (await file.getFile()).arrayBuffer())];
                let rolledBack = false;
                try {
                    await writeNewDirectory(directory, plan, { mode: 'merge', overwritePaths: ['original.bin'],
                        onProgress: () => { throw new Error('Injected after a real OPFS file commit'); } });
                } catch (error) { rolledBack = error.rolledBack && error.leftovers.length === 0; }
                const restored = [...new Uint8Array(await (await file.getFile()).arrayBuffer())];
                const names = [];
                for await (const [name] of directory.entries()) names.push(name);
                let confirmation = '';
                const created = await commitWizardDirectory(directory, plan, { confirmOverwrite: message => { confirmation = message; return true; } });
                const changed = [...new Uint8Array(await (await file.getFile()).arrayBuffer())];
                return { declined: declined.cancelled, before, restored, rolledBack, names, changed, confirmation,
                    attachedRecords: created.disk.records.length, sameHandle: await created.directoryHandle.isSameEntry(directory) };
            } finally { await root.removeEntry('a24-template-destination', { recursive: true }); }
        }''')
        truth(result['declined'])
        truth(result['before'] == [0, 255, 128, 13, 10])
        truth(result['restored'] == result['before'] and result['rolledBack'])
        truth(result['names'] == ['original.bin'])
        truth(result['changed'] == [9, 8, 7])
        truth('original.bin' in result['confirmation'])
        truth(result['attachedRecords'] == 2 and result['sameHandle'])

    check('Actual OPFS files honor overwrite preflight, restore byte-exactly on failure, and return attachable disk records', opfs_destination)

    def browser_streams():
        result = page.evaluate('''async () => {
            const { writeZipTo, openZip, readZip } = await window.__sharpforgeTestImport('/packages/archive/src/index.js');
            const expected = new TextEncoder().encode('Browser streaming ZIP64\\n'.repeat(5000));
            const chunks = [];
            const output = await writeZipTo([{ path: 'Source.cs', bytes: expected }],
                new WritableStream({ write: bytes => chunks.push(bytes.slice()) }), { compression: 'deflate' });
            const blob = new Blob(chunks);
            const archive = await openZip(blob);
            const bytes = new Uint8Array(await new Response(archive.stream('Source.cs')).arrayBuffer());
            archive.close();
            const synchronous = readZip(new Uint8Array(await blob.arrayBuffer()))[0].bytes;
            return { count: bytes.length, expected: expected.length, equal: bytes.every((value, index) => value === expected[index]),
                reread: synchronous.every((value, index) => value === expected[index]), backend: output.compressionBackend };
        }''')
        truth(result['count'] == result['expected'] and result['equal'] and result['reread'])
        truth(result['backend'] == 'portable-fixed')

    check('Chromium Blob, ReadableStream and WritableStream ZIP64 compression round-trip exact bytes', browser_streams)
    check('No page JavaScript errors', lambda: truth(not errors, json.dumps(errors)))
    (RESULTS / 'browser-a24-templates.json').write_text(json.dumps({
        'passed': len(checks), 'checks': checks, 'errors': errors, 'filesystem': 'actual origin-private file system',
        'picker': 'DOM workflow with explicit cancellation response; native OS dialog not automated',
        'targets': ['Chromium HTTP/CSP', 'OPFS'], 'windowsNative': 'not qualified'
    }, indent=2) + '\n', encoding='utf8')
