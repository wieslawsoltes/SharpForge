"""Real Chromium DOM/pointer qualification for the complete A19 docking batch."""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from functools import partial
from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser

ROOT = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(ROOT)))
thread = Thread(target=server.serve_forever, daemon=True)
thread.start()

try:
    with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.goto(f'http://127.0.0.1:{server.server_port}/packages/docking/examples/index.html')
        page.wait_for_function('window.dockingDemo !== undefined')
        for scope, side in [('group', s) for s in ['left', 'right', 'top', 'bottom', 'center']] + [('root', s) for s in ['left', 'right', 'top', 'bottom']]:
            result = page.evaluate('''({scope,side}) => {
              const {layout,host,initial}=dockingDemo;
              layout.restore(initial);
              const tab=document.querySelector('[data-dock-tab="watch"]');
              const group=document.querySelector('[data-dock-group="documents"]');
              const r=tab.getBoundingClientRect();
              tab.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:7,clientX:r.x+10,clientY:r.y+10}));
              const g=group.getBoundingClientRect();
              tab.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'touch',pointerId:7,clientX:g.x+g.width/2,clientY:g.y+g.height/2}));
              const guide=document.querySelector(`[data-dock-target="${scope}-${side}"]`);
              if(!guide) throw new Error('Missing explicit guide');
              const target=guide.getBoundingClientRect();
              tab.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'touch',pointerId:7,clientX:target.x+target.width/2,clientY:target.y+target.height/2}));
              tab.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'touch',pointerId:7,clientX:target.x+target.width/2,clientY:target.y+target.height/2}));
              layout.validate(layout.state);
              const where=layout.locate('watch');
              return {group:where.group.id,count:layout.groups().flatMap(g=>g.panels).filter(id=>id==='watch').length};
            }''', {'scope': scope, 'side': side})
            assert result['count'] == 1, result
            assert (result['group'] == 'documents') == (scope == 'group' and side == 'center'), result
        page.evaluate('dockingDemo.layout.restore(dockingDemo.initial)')
        textarea = page.locator('[data-dock-panel="document-a"] textarea')
        textarea.fill('retained document state')
        textarea.evaluate('(element)=>{element.focus();element.setSelectionRange(4,8)}')
        page.evaluate('dockingDemo.layout.floatGroup("tools")')
        assert textarea.input_value() == 'retained document state'
        assert textarea.evaluate('element=>element.selectionStart') == 4
        page.locator('[aria-label="Dock floating group"]').click()
        assert page.evaluate('dockingDemo.layout.state.floating.length') == 0
        page.evaluate('dockingDemo.layout.autoHide("watch","right")')
        page.locator('[data-dock-toggle="watch"]').click()
        assert page.locator('.sf-dock-auto-popup.right').is_visible()
        page.locator('[aria-label="Pin tool window"]').click()
        assert page.evaluate('dockingDemo.layout.locate("watch").group.id') == 'tools'
        with page.expect_popup() as popup_info:
            page.evaluate('dockingDemo.host.popout("document-a")')
        popup = popup_info.value
        popup.wait_for_load_state()
        popup.locator('textarea').fill('edited in popout')
        popup.keyboard.press('F5')
        assert 'F5 forwarded' in page.locator('#status').inner_text()
        popup.close()
        page.wait_for_function('dockingDemo.host.popouts.size===0')
        assert page.locator('[data-dock-panel="document-a"] textarea').input_value() == 'edited in popout'
        print('A19 docking browser: nine pointer targets, retained focus/state, floating groups, flyout pin, popout F5 and reattach passed')
finally:
    server.shutdown()
    server.server_close()
