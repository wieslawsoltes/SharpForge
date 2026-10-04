"""A24 actual Chromium OPFS persistence and sync-worker qualification under production CSP.

File-picker permission UI remains a separate manual platform check. Directory handle operations use real OPFS handles.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir
from browser_harness import load_application

if os.getenv('SHARPFORGE_IN_MEMORY') == '1':
    raise RuntimeError('OPFS qualification requires the production HTTP origin, not an about:blank storage substitute')

checks = []
with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
    page = browser.new_page()
    load_application(page)
    result = page.evaluate("""async () => {
      const {OriginPrivateFileSystemProvider, FileSystemAccessProvider} = await import('/packages/workspace/src/index.js');
      const provider = await OriginPrivateFileSystemProvider.open({name:'a24-conformance', workerThresholdBytes:1});
      try { await provider.delete('src', {recursive:true}); } catch(error) { if(error.code !== 'NotFound') throw error; }
      await provider.createDirectory('src');
      const bytes = Uint8Array.from({length:1048583}, (_,index) => (index * 17) & 255);
      const saved = await provider.writeFile('src/bytes.bin', bytes, {expectedHash:null});
      const read = await provider.readFile('src/bytes.bin');
      if (read.length !== bytes.length || !read.every((value,index) => value === bytes[index])) throw Error('Byte mismatch');
      if (saved.backend !== 'opfs-sync-worker') throw Error('Sync worker backend was not used');
      const fsa = new FileSystemAccessProvider(provider.rootHandle);
      await fsa.rename('src/bytes.bin', 'src/renamed.bin');
      const renamed = await fsa.readFile('src/renamed.bin');
      if (!renamed.every((value,index) => value === bytes[index])) throw Error('Rename mismatch');
      const controller = new AbortController();
      controller.abort();
      let cancelled = false;
      try { await provider.writeFile('src/cancelled.bin', bytes, {signal:controller.signal}); }
      catch(error) { cancelled = error.name === 'AbortError'; }
      if (!cancelled) throw Error('Cancellation was not reported');
      const quota = await provider.quota();
      const entries = await provider.readDirectory('src');
      provider.dispose();
      return {backend:saved.backend, size:bytes.length, hash:saved.hash, quota, names:entries.map(entry=>entry.name)};
    }""")
    checks.append({'name': 'real OPFS sync worker read/write/rename/cancellation/quota', 'passed': True, **result})
    page.reload()
    persisted = page.evaluate("""async () => {
      const {OriginPrivateFileSystemProvider} = await import('/packages/workspace/src/index.js');
      const provider = await OriginPrivateFileSystemProvider.open({name:'a24-conformance', workerThresholdBytes:1});
      const bytes = await provider.readFile('src/renamed.bin');
      const correct = bytes.length === 1048583 && bytes.every((value,index) => value === ((index * 17) & 255));
      await provider.delete('src', {recursive:true});
      provider.dispose();
      return correct;
    }""")
    if not persisted:
        raise AssertionError('Reloaded OPFS workspace did not retain exact bytes')
    checks.append({'name': 'real OPFS bytes persist across reload', 'passed': True})
    ui = page.evaluate((Path(__file__).parent / 'support' / 'a24-browser-ui.js').read_text())
    checks.append({'name': 'explorer disk services and 10000-file paged DOM', 'passed': True, **ui})
    large = page.evaluate((Path(__file__).parent / 'support' / 'a24-large-explorer.js').read_text())
    checks.append({'name': 'default 20000-file SolutionExplorer uses visible folder paging', 'passed': True, **large})
    engine_version = browser.version

destination = results_dir() / 'a24-vfs-browser-results.json'
destination.write_text(json.dumps({'checks': checks, 'engine': engine_version,
    'qualification': 'Chromium OPFS, memory-provider UI and Web Locks; native picker permission UI not exercised'}, indent=2))
print(json.dumps({'passed': len(checks), 'results': str(destination)}))
