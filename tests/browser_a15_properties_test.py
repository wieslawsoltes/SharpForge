"""A15 public JavaScript app boundary fixtures; run only with the completed scope's browser gate."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
from browser_harness import load_application
from conformance.browser.launch import launch_browser, results_dir
from playwright.sync_api import sync_playwright

INSTALL = (ROOT / 'tests/helpers/a15-property-public-browser.js').read_text(encoding='utf8')


def run():
    results = {'engine': 'public-javascript', 'backend': 'dom', 'cases': {}, 'status': 'failed'}
    destination = results_dir() / 'a15-properties'
    destination.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
        page = browser.new_page(viewport={'width': 1000, 'height': 800})
        try:
            load_application(page)
            page.evaluate('(' + INSTALL + ')()')
            results['cases']['defaultStyleKey'] = page.evaluate('a15Properties.defaultStyleKey()')
            results['status'] = 'passed'
        except Exception as error:
            results['error'] = str(error)
            page.screenshot(path=str(destination / 'failure.png'), full_page=True)
            raise
        finally:
            page.evaluate('window.a15Properties?.dispose()')
            (destination / 'results.json').write_text(json.dumps(results, indent=2) + '\n', encoding='utf8')


if __name__ == '__main__':
    run()
