"""In-memory browser loader for restricted CI environments that disallow all URL navigation.

It executes the built HTML/CSS and the same ESM/worker modules using Blob URLs.
It performs no network requests and does not modify browser policy. Storage is a
harness-only in-memory replacement when the about:blank origin forbids Storage.
Normal CI/browser tests use HTTP instead, by leaving SHARPFORGE_IN_MEMORY unset.
"""
import json
import os
from conformance.browser.launch import load_http
from pathlib import Path
from playwright.sync_api import Page

ROOT = Path(__file__).resolve().parents[1]


def _wait_for_function(page, expression, *, arg=None, timeout=None, polling=None):
    """CSP-safe Page.wait_for_function.

    Playwright re-evaluates string predicates with eval() inside the page, which the
    served Content-Security-Policy (no 'unsafe-eval') rejects. Polling page.evaluate
    from Python keeps the production policy intact instead of bypassing it.
    """
    import time
    interval = polling if isinstance(polling, (int, float)) else 20
    deadline = time.monotonic() + (30000 if timeout is None else timeout) / 1000
    while True:
        value = page.evaluate(expression, arg)
        if value:
            return value
        if timeout != 0 and time.monotonic() >= deadline:
            raise TimeoutError('Browser predicate remained false: ' + expression)
        page.wait_for_timeout(interval)

Page.wait_for_function = _wait_for_function

def load_application(page, connect_origins=(), *, keep_startup=False):
    if os.getenv('SHARPFORGE_IN_MEMORY') != '1':
        load_http(page, connect_origins)
    else:
        _load_in_memory(page)
    if not keep_startup:
        complete_startup(page)
    return page


def complete_startup(page):
    """Exercise the first-run/start actions so existing workflow fixtures begin in the editor."""
    first = page.get_by_role('dialog', name='Choose Your Development Environment', exact=True)
    if first.is_visible():
        first.get_by_role('button', name='Start coding', exact=True).click()
    start = page.get_by_role('dialog', name='Start SharpForge Studio', exact=True)
    if start.is_visible():
        start.get_by_role('button', name='Continue without code', exact=True).click()


def _load_in_memory(page):

    dist = ROOT / 'dist'
    html = (dist / 'index.html').read_text(encoding='utf-8')
    html = html.replace('<link rel="stylesheet" href="./studio.css">', '<style>' + (dist / 'studio.css').read_text(encoding='utf-8') + '</style>')
    html = html.replace('<script type="module" src="./studio.js"></script>', '')
    html = html.replace('<link rel="icon" href="./favicon.svg" type="image/svg+xml">', '')
    sources = {'/' + str(p.relative_to(dist)): p.read_text(encoding='utf-8') for p in dist.rglob('*.js')}
    page.set_content(html)
    page.evaluate(r"""sources => {
        const memory = new Map();
        const storage = {getItem: key => memory.get(key) ?? null, setItem: (key,value) => memory.set(key,String(value)), removeItem: key => memory.delete(key), clear: () => memory.clear()};
        try { localStorage.getItem('probe'); } catch { Object.defineProperty(window, 'localStorage', {value:storage}); }
        const urls = new Map();
        const visiting = new Set();
        function resolve(path, from) { return new URL(path, 'https://in-memory.invalid' + from).pathname; }
        function build(path) {
            if (urls.has(path)) return urls.get(path);
            if (visiting.has(path)) throw new Error('Cyclic module graph: ' + path);
            visiting.add(path);
            let source = sources[path];
            if (source === undefined) throw new Error('Missing module ' + path);
            source = source.replace(/new URL\(\s*(['"])(\.[^'"]+\.js)\1,\s*import\.meta\.url\s*\)/g,
                (_, quote, child) => 'new URL(' + JSON.stringify(build(resolve(child,path))) + ')');
            source = source.replace(/\bimport\(\s*(['"])(\.[^'"]+)\1\s*\)/g,
                (_, quote, dependency) => 'import(' + JSON.stringify(build(resolve(dependency,path))) + ')');
            source = source.replace(/(from\s*|import\s*)(['"])(\.[^'"]+)\2/g, (_, prefix, quote, dependency) => prefix + quote + build(resolve(dependency,path)) + quote);
            const url = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
            urls.set(path, url); visiting.delete(path); return url;
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
