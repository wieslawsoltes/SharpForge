"""Docking DOM/pointer qualification against built assets and the production CSP."""
from playwright.sync_api import sync_playwright
from browser_harness import wait_condition
from conformance.browser.launch import launch_browser
from conformance.browser.editor_fixture import editor_fixture

with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser, \
        editor_fixture('index', package='docking') as url:
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    page.goto(url)
    wait_condition(page, lambda: page.evaluate('window.dockingDemo !== undefined'))
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
    wait_condition(page, lambda: page.evaluate('dockingDemo.host.popouts.size===0'))
    assert page.locator('[data-dock-panel="document-a"] textarea').input_value() == 'edited in popout'
    print('A19 docking browser: nine pointer targets, retained focus/state, floating groups, flyout pin, popout F5 and reattach passed')
