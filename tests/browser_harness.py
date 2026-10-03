"""In-memory browser loader for restricted CI environments that disallow all URL navigation.

It executes the built HTML/CSS and the same ESM/worker modules using Blob URLs.
It performs no network requests and does not modify browser policy. Storage is a
harness-only in-memory replacement when the about:blank origin forbids Storage.
Normal CI/browser tests use HTTP instead, by leaving SHARPFORGE_IN_MEMORY unset.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def load_in_memory(page):
    dist = ROOT / 'dist'
    html = (dist / 'index.html').read_text()
    html = html.replace('<link rel="stylesheet" href="./studio.css">', '<style>' + (dist / 'studio.css').read_text() + '</style>')
    html = html.replace('<script type="module" src="./studio.js"></script>', '')
    html = html.replace('<link rel="icon" href="./favicon.svg" type="image/svg+xml">', '')
    sources = {'/' + str(p.relative_to(dist)): p.read_text() for p in dist.rglob('*.js')}
    page.set_content(html)
    page.evaluate(r"""sources => {
        const memory = new Map();
        const storage = {getItem: key => memory.get(key) ?? null, setItem: (key,value) => memory.set(key,String(value)), removeItem: key => memory.delete(key), clear: () => memory.clear()};
        try { localStorage.getItem('probe'); } catch { Object.defineProperty(window, 'localStorage', {value:storage}); }
        const urls = new Map();
        function resolve(path, from) { return new URL(path, 'https://in-memory.invalid' + from).pathname; }
        function build(path) {
            if (urls.has(path)) return urls.get(path);
            let source = sources[path];
            if (source === undefined) throw new Error('Missing module ' + path);
            source = source.replace(/new URL\(['"](\.\/[^'"]+\.worker\.js)['"],\s*import\.meta\.url\)/g, (_, child) => 'new URL(' + JSON.stringify(build(resolve(child,path))) + ')');
            source = source.replace(/(from\s*|import\s*)(['"])(\.[^'"]+)\2/g, (_, prefix, quote, dependency) => prefix + quote + build(resolve(dependency,path)) + quote);
            const url = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
            urls.set(path, url); return url;
        }
        window.__sharpforgeTestImport = path => import(build(path));
        window.__moduleReady = import(build('/studio.js')).catch(error => { window.__loaderError = String(error); console.error(error); });
    }""", sources)
    page.wait_for_function('window.sharpforge && window.sharpforge.getState().metrics !== null', timeout=20000)


def wait_condition(page, predicate, timeout=30000):
    """Await async predicates before testing truth, rather than accepting a truthy Promise."""
    import time
    if not predicate.lstrip().startswith('async'):
        return page.wait_for_function(predicate, timeout=timeout)
    deadline = time.monotonic() + timeout / 1000
    while True:
        value = page.evaluate(predicate)
        if value:
            return value
        if time.monotonic() >= deadline:
            raise TimeoutError('Async browser predicate remained false: ' + predicate)
        page.wait_for_timeout(20)
