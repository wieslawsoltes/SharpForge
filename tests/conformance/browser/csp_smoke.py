"""The shared launcher's CSP gate must reject inline-script violations on each engine."""
from pathlib import Path
import argparse
import json
import sys
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'tests'))
from conformance.browser.launch import launch_browser,results_dir
from conformance.browser.matrix_common import serving,wait

def verify(engine):
    from playwright.sync_api import sync_playwright
    for kind in ('inline','handler'):
        observed=None
        with serving('http') as url, sync_playwright() as p:
            try:
                with launch_browser(p,'csp-negative-'+engine+'-'+kind,engine=engine) as browser:
                    page=browser.new_page();page.goto(url)
                    wait(page,'window.sharpforge && window.sharpforge.getState().metrics!==null')
                    if kind=='inline':page.evaluate("() => {const s=document.createElement('script');s.textContent='window.__forbiddenInline=42';document.head.appendChild(s);}")
                    else:page.evaluate("() => {const b=document.createElement('button');b.setAttribute('onclick','window.__forbiddenInline=42');document.body.appendChild(b);b.click();}")
                    page.wait_for_timeout(100)
                    assert page.evaluate('window.__forbiddenInline===undefined')
            except AssertionError as error:
                if 'Browser CSP violations:' not in str(error):raise
                observed=str(error)
        assert observed, 'Injected violation was not rejected by shared launcher'
    (results_dir()/('csp-negative-'+engine+'.json')).write_text(json.dumps({'engine':engine,'passed':True,'checks':['inline script rejected','inline event handler rejected'],'scope':'Actual browser CSP failure gate, intentionally violating fixture; not a clean product suite'},indent=2)+'\n',encoding='utf8')
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--engine',choices=('chromium','firefox','webkit'),required=True)
    verify(parser.parse_args().engine)
