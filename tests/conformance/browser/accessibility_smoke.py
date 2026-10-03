"""Validate name/role auditing against actual browser ARIA output, including YAML quotes."""
from pathlib import Path
import argparse
import sys
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'tests'))
from conformance.browser.launch import launch_browser
from conformance.browser.a11y_test import names

def verify(engine):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p,launch_browser(p,'a11y-fixture-'+engine,engine=engine) as browser:
        page=browser.new_page()
        page.set_content('<button id="good" aria-label="Window actions: Fixture">⌄</button><button id="bad"></button><button hidden></button>')
        violations=names(page)
        assert [v['selector'] for v in violations]==['#bad'],violations
        page.locator('#bad').evaluate('e=>e.setAttribute("aria-label","Repaired")')
        assert names(page)==[]
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--engine',choices=('chromium','firefox','webkit'),required=True)
    verify(parser.parse_args().engine)
