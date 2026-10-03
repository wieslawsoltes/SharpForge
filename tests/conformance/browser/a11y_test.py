"""Browser ARIA snapshots plus actual keyboard input; selectors retained for violations."""
from pathlib import Path
import sys
_ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(_ROOT/'tests'))

import re
from conformance.browser.matrix_common import truth
INTERACTIVE='button, a[href], input:not([type=hidden]), textarea, select, [role=button], [role=tab], [role=menuitem], [role=treeitem], [role=separator], [tabindex]'

def names(page):
    rows=[]
    controls=page.locator(INTERACTIVE)
    for i in range(controls.count()):
        item=controls.nth(i)
        if not item.is_visible():continue
        selector=item.evaluate('''e=>{if(e.id)return '#'+CSS.escape(e.id);let parts=[];for(let n=e;n&&n.nodeType===1&&parts.length<6;n=n.parentElement){let s=n.tagName.toLowerCase();if(n.id){parts.unshift('#'+CSS.escape(n.id));break;}s+=':nth-child('+([...n.parentElement.children].indexOf(n)+1)+')';parts.unshift(s);}return parts.join(' > ');}''')
        snapshot=item.aria_snapshot()
        first=snapshot.split('\n')[0] if snapshot else ''
        # Actual accessibility representation, not a DOM text/aria-label approximation.
        if not re.search(r'^[\w -]+ "[^"\n]+"', first.removeprefix('- ').lstrip("'")):
            rows.append({'selector':selector,'snapshot':snapshot})
    return rows

def tab_to(page, selector, limit=100):
    visits={}
    for _ in range(limit):
        page.keyboard.press('Tab')
        if page.evaluate('selector=>document.activeElement?.matches(selector)',selector):return
        active=page.evaluate('document.activeElement?.outerHTML.slice(0,200)')
        visits[active]=visits.get(active,0)+1
        if visits[active]>=5:raise AssertionError('Keyboard focus cannot escape '+str(active)+' to reach '+selector)
    raise AssertionError('Keyboard traversal cannot reach '+selector)

def qualify(checks, **options):
    page=checks.page
    def named():
        violations=names(page)
        (checks.directory/'accessibility-violations.json').write_text(__import__('json').dumps(violations,indent=2)+'\n',encoding='utf8')
        (checks.directory/'accessibility-tree.yml').write_text(page.locator('body').aria_snapshot(),encoding='utf8')
        truth(not violations, 'Unnamed interactive controls: '+repr(violations))
    checks.check('accessible-names-and-roles',named)
    def keyboard():
        tab_to(page,'[data-menu="file"]');page.keyboard.press('Enter')
        truth(page.locator('#menu-popup').is_visible(),'Keyboard menu did not open')
        page.keyboard.press('ArrowDown');page.keyboard.press('Escape')
        truth(not page.locator('#menu-popup').is_visible(),'Escape did not close menu')
        tab_to(page,'.sf-dock-tab');before=page.evaluate('document.activeElement.dataset.dockTab')
        page.keyboard.press('ArrowRight')
        truth(page.evaluate('document.activeElement.dataset.dockTab') not in (None,before),'Docking arrow traversal did not move')
        tab_to(page,'.sf-dock-divider');before=page.evaluate('document.activeElement.getAttribute("aria-valuenow")')
        page.keyboard.press('ArrowRight')
        truth(page.locator('.sf-dock-divider').first.get_attribute('aria-valuenow')!=before,'Keyboard docking resize did not change value')
        tab_to(page,'.sf-input');page.keyboard.press('End');page.keyboard.type(' // keyboard')
        truth(page.evaluate('document.activeElement.value.endsWith("// keyboard")'),'Keyboard editor input failed')
    checks.check('keyboard-menu-docking-editor',keyboard)
    for feature,value in [('forced_colors','active'),('reduced_motion','reduce')]:
        def media(feature=feature,value=value):
            page.reload()
            from conformance.browser.matrix_common import wait
            wait(page,'window.sharpforge && window.sharpforge.getState().metrics!==null')
            page.emulate_media(**{feature:value})
            query='(forced-colors: active)' if feature=='forced_colors' else '(prefers-reduced-motion: reduce)'
            truth(page.evaluate('q=>matchMedia(q).matches',query),'Media preference not active: '+query)
            truth(page.locator('.sf-input:visible').first.is_visible(),'Editor hidden under media preference')
            tab_to(page,'[data-menu="file"]');page.keyboard.press('Enter');truth(page.locator('#menu-popup').is_visible());page.keyboard.press('Escape')
            page.screenshot(path=str(checks.directory/(feature+'.png')))
        checks.check(feature,media)

if __name__=='__main__':
    import os, subprocess
    sys.exit(subprocess.call([sys.executable,str(_ROOT/'tests/conformance/browser/run_matrix.py'),'--engine',os.getenv('SHARPFORGE_BROWSER_ENGINE','chromium'),'--suite','a11y'],cwd=_ROOT))
