"""Actual browser regression checks for touch toggles, accessible labels and editor Tab escape."""
from pathlib import Path
import argparse
import json
import sys
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'tests'))
from conformance.browser.launch import launch_browser,results_dir
from conformance.browser.matrix_common import Checks,load,serving,truth,wait

def qualify(engine):
    from playwright.sync_api import sync_playwright
    rows=[]
    with serving('http') as url,sync_playwright() as p,launch_browser(p,'ui-regressions-'+engine,engine=engine) as browser:
        page=browser.new_page(viewport={'width':1440,'height':1000},has_touch=True)
        load(page,url,mode='http');checks=Checks(page,results_dir()/('ui-regressions-'+engine));rows=checks.rows
        def label():
            box=page.get_by_role('combobox',name='Show output from:')
            truth(box.count()==1,'Output filter accessible label missing')
            box.select_option('program');truth(box.input_value()=='program')
        checks.check('output-filter-label',label)
        def escape(profile,reverse=False):
            page.evaluate('profile=>sharpforge.setKeymap(profile)',profile)
            target=page.locator('.CodeMirror:visible').first if profile in ('vim','emacs','sublime') else page.locator('.sf-input:visible').first
            target.click()
            before=page.evaluate('sharpforge.getState().files.map(f=>f.text)')
            page.evaluate('window.__qualificationInput=document.activeElement')
            page.keyboard.press('Escape');page.keyboard.press('Shift+Tab' if reverse else 'Tab')
            wait(page,'window.__qualificationInput!==document.activeElement',timeout=2000)
            page.wait_for_timeout(50)
            truth(page.evaluate('window.__qualificationInput!==document.activeElement'),'Editor recaptured focus: '+profile)
            truth(page.evaluate('sharpforge.getState().files.map(f=>f.text)')==before,'Escape+Tab modified source: '+profile)
        for profile in ('visual-studio','vscode','vim','emacs','sublime'):
            checks.check('escape-tab-'+profile,lambda profile=profile:escape(profile))
            checks.check('escape-shift-tab-'+profile,lambda profile=profile:escape(profile,True))
        def ordinary():
            page.evaluate('sharpforge.setKeymap("visual-studio")')
            area=page.locator('.sf-input:visible').first;area.click();page.keyboard.press('End')
            before=area.input_value();page.keyboard.press('Tab')
            truth(len(area.input_value())==len(before)+4,'Ordinary Tab no longer indents')
            page.keyboard.press('Escape');page.keyboard.type('x');page.keyboard.press('Tab')
            truth(page.evaluate('document.activeElement.matches(".sf-input")'),'Intervening typing did not cancel escape')
            truth(len(area.input_value())==len(before)+9)
        checks.check('ordinary-tab-and-intervening-edit',ordinary)
        def dispose():
            result=page.evaluate('''async()=>{const {installTabEscape}=await __sharpforgeTestImport(location.origin+'/packages/editor/src/tab-focus.js');const input=document.createElement('textarea');input.setAttribute('aria-description','Original');document.body.appendChild(input);let received=0;const release=installTabEscape(input);input.addEventListener('keydown',()=>received++);input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab'}));const before=received;release();release();input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab'}));const result={before,after:received,description:input.getAttribute('aria-description')};input.remove();return result;}''')
            truth(result=={'before':1,'after':3,'description':'Original'},repr(result))
            return {'scope':'Synthetic DOM event disposal boundary, separately from native keyboard checks'}
        checks.check('escape-handler-disposal',dispose)
        def touch():
            page.set_viewport_size({'width':390,'height':844})
            for selector,panel in [('toggleExplorer','#solution'),('toggleTools','#diagnostic-tools')]:
                target=page.locator('footer [data-command="'+selector+'"]')
                for _ in range(3):
                    target.tap();truth(page.locator(panel).is_visible(),'Touch did not open '+panel)
                    target.tap();truth(not page.locator(panel).is_visible(),'Touch did not close '+panel)
                target.tap();page.locator('[data-menu="file"]').tap();page.keyboard.press('Escape')
                truth(not page.locator(panel).is_visible(),'Outside pointer did not dismiss '+panel)
            page.set_viewport_size({'width':1440,'height':1000})
        checks.check('phone-repeated-touch-and-outside-dismiss',touch)
        checks.check('csp-clean',browser.csp.assert_clean)
        (checks.directory/'regressions.json').write_text(json.dumps({'engine':engine,'browserVersion':browser.version,'checks':rows},indent=2)+'\n',encoding='utf8')
        if any(row['status']!='passed' for row in rows):raise AssertionError('UI regressions failed')
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--engine',required=True,choices=('chromium','firefox','webkit'))
    qualify(parser.parse_args().engine)
