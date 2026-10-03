"""Desktop-engine device emulation; no physical keyboard or mobile OS claims."""
from conformance.browser.matrix_common import compile_run, truth, wait
DEVICES = ('iPhone 13', 'Pixel 5', 'iPad (gen 7)')

def qualify(checks, *, device, **options):
    page=checks.page
    page.evaluate("() => {window.__qualificationTouchEvents=0;addEventListener('touchstart',()=>window.__qualificationTouchEvents++,{capture:true});}")
    checks.check('mobile-compile-run', lambda: compile_run(page))
    def layout():
        value=page.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,touch:navigator.maxTouchPoints})')
        truth(value['scroll']<=value['width']+1, 'Horizontal viewport overflow: '+repr(value))
        truth(page.locator('.sf-input:visible').first.is_visible(), 'Editor unreachable')
        return value
    checks.check('mobile-layout', layout)
    def overlay():
        before=page.locator('#solution').is_visible()
        try:
            page.locator('footer [data-command="toggleExplorer"]').tap()
            truth(page.locator('#solution').is_visible()!=before, 'Solution visibility did not toggle on first touch')
            page.locator('footer [data-command="toggleExplorer"]').tap()
            truth(page.locator('#solution').is_visible()==before, 'Solution visibility did not restore on second touch; auto-hide popup intercepts editor controls')
        finally:page.keyboard.press('Escape')
    checks.check('touch-overlay-toggle', overlay)
    def touches():
        page.locator('[data-dock-tab="problems"]').tap()
        truth(page.locator('[data-tool="problems"]').is_visible(), 'Touch cannot activate docked tool')
        page.evaluate('sharpforge.floatPanel("output")')
        try:
            page.get_by_role('button',name='Dock floating group',exact=True).tap()
            truth(page.locator('.sf-dock-floating').count()==0, 'Touch redocking failed')
            count=page.evaluate('window.__qualificationTouchEvents')
            truth(count>0, 'No native browser touch events observed')
            return {'observedTouchStarts':count}
        finally:
            page.evaluate('sharpforge.dockPanel("output","tools-bottom","center")')
    checks.check('touch-docking', touches)
    def keyboard():
        area=page.locator('.sf-input:visible').first
        area.tap();page.keyboard.press('End');page.keyboard.type(' // touch focus')
        truth(area.input_value().endswith('// touch focus'), 'Focused editor did not accept keyboard input')
        size=page.viewport_size
        page.set_viewport_size({'width':390,'height':420})
        try:
            area.scroll_into_view_if_needed()
            box=area.bounding_box()
            truth(box and box['width']>0 and box['y']<420, 'Editor unreachable after viewport shrink')
        finally:page.set_viewport_size(size)
        return {'scope':'Touch focus, keyboard input and 390px reduced viewport; no OS virtual keyboard was opened.'}
    checks.check('keyboard-focus-and-small-viewport', keyboard)
    checks.unsupported('physical-device-and-virtual-keyboard', 'Playwright desktop '+options['engine']+' device descriptor emulation does not qualify '+device+' hardware, mobile OS, IME, or the OS virtual keyboard.')
    if options['engine']=='firefox':
        checks.unsupported('mobile-viewport-meta', 'Playwright Firefox does not implement is_mobile; viewport and has_touch are tested, mobile viewport-meta behavior is unsupported.')
