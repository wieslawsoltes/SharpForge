"""Project 18 Explorer corpus on production Chromium/CSP, OPFS and native HTTP.

The native transport bridge forwards bytes to a real authenticated loopback host.
The browser folder is a real OPFS directory. OS picker dialogs, Windows and macOS
are independent qualifications; this suite does not infer their results.
"""
from contextlib import nullcontext
from io import BytesIO
import base64
import hashlib
import json
import os
import platform
import time
import zipfile
from playwright.sync_api import sync_playwright
from browser_harness import load_application
from conformance.browser.launch import launch_browser, results_dir
from workspace_corpus_support import load_corpus, native_host, disk_snapshot, assert_original

RESULTS = results_dir()
CASES = load_corpus()

OPEN_BROWSER = """async item => {
  const api = await __sharpforgeTestImport('/packages/project-system/src/index.js');
  const root = await navigator.storage.getDirectory();
  const name = 'sharpforge-corpus-' + item.id;
  try { await root.removeEntry(name, {recursive: true}); }
  catch (error) { if (error.name !== 'NotFoundError') throw error; }
  const handle = await root.getDirectoryHandle(name, {create: true});
  const records = item.records.map(record => api.decodeWorkspaceFile(record.path,
    Uint8Array.from(atob(record.base64), character => character.charCodeAt(0))));
  await api.writeNewDirectory(handle, {records, folders: item.folders});
  const disk = await api.readProviderDirectory(handle);
  window.__corpusHandle = handle;
  window.__corpusSettings = item.settings;
  await sharpforge.loadDiskRecords(disk.records, {...item.settings, disk, folders: disk.folders});
} """

OPFS_SNAPSHOT = """async () => {
  const files = [], folders = [];
  async function walk(handle, prefix = '') {
    for await (const [name, child] of handle.entries()) {
      const path = prefix + name;
      if (child.kind === 'directory') {
        folders.push(path); await walk(child, path + '/');
      } else {
        const bytes = await (await child.getFile()).arrayBuffer();
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        files.push({path, size: bytes.byteLength,
          sha256: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')});
      }
    }
  }
  await walk(__corpusHandle);
  return {files: files.sort((a, b) => a.path.localeCompare(b.path)), folders: folders.sort()};
} """

CONNECT_NATIVE = """async token => {
  const {MSBuildClient} = await __sharpforgeTestImport('/packages/msbuild/src/index.js');
  const fetcher = async (path, options) => {
    const result = await __corpusNativeHttp(path,
      {method: options.method, headers: options.headers, body: options.body});
    return new Response(Uint8Array.from(atob(result.bytes), character => character.charCodeAt(0)),
      {status: result.status, headers: result.headers});
  };
  window.__corpusNativeClient = new MSBuildClient({token, fetch: fetcher});
  await sharpforge.native.connect(__corpusNativeClient);
  await sharpforge.native.attach();
} """


def wait_idle(page):
    page.wait_for_function('!sharpforge.getExplorer().busy', timeout=20000)


def command(page, action, path=None, kind=None, dialog=False):
    wait_idle(page)
    expression = '([a,p,k])=>{void sharpforge.explorerCommand(a,p,k);}' if dialog else \
        '([a,p,k])=>sharpforge.explorerCommand(a,p,k)'
    page.evaluate(expression, [action, path, kind])


def rename(page, path, destination):
    command(page, 'rename', path, 'file', dialog=True)
    page.locator('#item-path').fill(destination)
    page.get_by_role('button', name='Apply', exact=True).click()
    wait_idle(page)


def source_path(case):
    return next(file['path'] for file in case['files'] if file['path'].endswith('.cs'))


def verify_zip(case, content):
    with zipfile.ZipFile(BytesIO(bytes(content))) as archive:
        names = set(archive.namelist())
        for file in case['files']:
            assert file['path'] in names, file['path']
            raw = archive.read(file['path'])
            assert hashlib.sha256(raw).hexdigest() == file['sha256'], file['path'] + ': exported bytes'
        for folder in case['folders']:
            assert folder + '/' in names, folder + ': exported directory'


def exercise(page, case, mode, snapshot):
    expected = snapshot()
    assert_original(case, expected)
    project = case['settings'].get('startup')
    parent = project.rsplit('/', 1)[0] if project else ''
    target = project or None
    kind = 'project' if project else None
    added = (parent + '/' if parent else '') + 'CorpusAdded.bin'
    renamed = (parent + '/' if parent else '') + 'CorpusRenamed.bin'
    destination = case['folders'][0]
    moved = destination + '/CorpusRenamed.bin'
    payload = bytes([0, 255, 128, 13, 10, 0, 42])

    with page.expect_file_chooser() as chooser:
        command(page, 'add-existing', target, kind, dialog=True)
    chooser.value.set_files({'name': 'CorpusAdded.bin', 'mimeType': 'application/octet-stream', 'buffer': payload})
    wait_idle(page)
    assert any(file['path'] == added for file in snapshot()['files']), added
    rename(page, added, renamed)
    command(page, 'cut', renamed, 'file')
    command(page, 'paste', destination, 'folder')
    wait_idle(page)
    assert any(file['path'] == moved for file in snapshot()['files']), moved
    command(page, 'delete', moved, 'file', dialog=True)
    page.get_by_role('button', name='Delete', exact=True).click()
    wait_idle(page)
    assert not any(file['path'] == moved for file in snapshot()['files']), moved
    for _ in range(4):
        command(page, 'undo')
        wait_idle(page)
    actual = snapshot()
    assert {file['path']: file for file in actual['files']} == {file['path']: file for file in expected['files']}
    assert set(actual['folders']) == set(expected['folders']), 'Undo changed directory records'

    path = source_path(case)
    command(page, 'open', path, 'source')
    editor = page.locator(f'[data-source-uri="{path}"] .sf-input')
    original = editor.input_value()
    editor.fill(original + '\n// Corpus save and reopen\n')
    page.evaluate('sharpforge.native.save()' if mode == 'native' else 'sharpforge.saveToDisk()')
    changed = next(file for file in snapshot()['files'] if file['path'] == path)
    prior = next(file for file in expected['files'] if file['path'] == path)
    assert changed['sha256'] != prior['sha256'], 'Save did not reach storage'
    editor.fill(original)
    page.evaluate('sharpforge.native.save()' if mode == 'native' else 'sharpforge.saveToDisk()')
    assert_original(case, snapshot())

    content = page.evaluate('async()=>Array.from(await sharpforge.exportWorkspaceZip())')
    verify_zip(case, content)
    if mode == 'native':
        page.evaluate('sharpforge.native.attach()')
    else:
        page.evaluate("""async () => {
          const api = await __sharpforgeTestImport('/packages/project-system/src/index.js');
          const disk = await api.readProviderDirectory(__corpusHandle);
          await sharpforge.loadDiskRecords(disk.records, {...__corpusSettings, disk, folders: disk.folders});
        }""")
    assert_original(case, snapshot())


def main():
    checks = []
    report = {'passed': False, 'platform': platform.platform(), 'engine': 'chromium', 'checks': checks,
              'qualification': {'browserFolder': 'OPFS directory handles', 'native': 'real loopback host and disk',
                                'osFolderPicker': 'not exercised', 'nativeBuilds': 'not requested'}}
    try:
        with sync_playwright() as playwright, launch_browser(playwright, __file__, engine='chromium') as browser:
            report['browserVersion'] = browser.version
            for mode in ('browser', 'native'):
                for case in CASES:
                    started = time.perf_counter()
                    context = native_host(case) if mode == 'native' else nullcontext(None)
                    with context as native:
                        page = browser.new_page(viewport={'width': 1580, 'height': 1000})
                        page.set_default_timeout(20000)
                        errors = []
                        page.on('pageerror', lambda error: errors.append(str(error)))
                        load_application(page)
                        if mode == 'native':
                            root, token, forward = native
                            page.expose_function('__corpusNativeHttp', forward)
                            page.evaluate(CONNECT_NATIVE, token)
                            snapshot = lambda: disk_snapshot(root)
                        else:
                            page.evaluate(OPEN_BROWSER, case)
                            snapshot = lambda: page.evaluate(OPFS_SNAPSHOT)
                        exercise(page, case, mode, snapshot)
                        assert not errors, errors
                        checks.append({'case': case['id'], 'mode': mode, 'passed': True,
                                       'milliseconds': round((time.perf_counter() - started) * 1000, 2)})
                        print('PASS', mode, case['id'], flush=True)
                        page.close()
        report['passed'] = True
    except Exception as error:
        report['failure'] = str(error)
        raise
    finally:
        (RESULTS / 'browser-explorer-corpus-results.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')


if __name__ == '__main__':
    main()
