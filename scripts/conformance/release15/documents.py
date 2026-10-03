"""Actual source controls and current global designer; no per-document session claim."""
import json
from browser_harness import wait_condition


def documents(page, root):
    directory = root / 'tests/conformance/release15/fixtures'
    records = [{'path': p.relative_to(directory).as_posix(), 'text': p.read_text(encoding='utf8')}
               for p in sorted(directory.rglob('*')) if p.is_file()]
    page.evaluate('records => sharpforge.loadDiskRecords(records,{name:"Release15"})', records)
    page.evaluate('() => sharpforge.setStartupProject("Dashboard/Dashboard.csproj")')
    assert len(page.evaluate('sharpforge.getState().project.projects')) == 3
    page.evaluate('() => sharpforge.setKeymap("visual-studio")')
    expected = {}
    for path in ['Dashboard/View.cs', 'Monitor/View.cs']:
        page.evaluate('path => sharpforge.openFile(path)', path)
        editor = page.locator('[data-source-uri=' + json.dumps(path) + '] .sf-input')
        original = editor.input_value()
        changed = original + '// release15 dirty buffer\n'
        editor.fill(changed)
        editor.press('ControlOrMeta+z')
        assert editor.input_value() == original, 'Undo lost the original buffer'
        editor.press('ControlOrMeta+Shift+z')
        assert editor.input_value() == changed, 'Redo lost the edited buffer'
        page.evaluate('p => sharpforge.setBreakpoints(p,[{line:7}])', path)
        page.evaluate('() => sharpforge.designer.open()')
        page.evaluate('p => sharpforge.designer.connect(p)', path)
        wait_condition(page, 'sharpforge.designer.get().sourceSync.state === "synced"')
        for mode in ['design', 'split', 'code']:
            page.evaluate('mode => sharpforge.designer.setView(mode)', mode)
            assert page.evaluate('sharpforge.designer.get().viewMode') == mode
        page.evaluate('path => sharpforge.openFile(path)', path)
        editor.evaluate('(element) => element.setSelectionRange(12,12)')
        expected[path] = page.evaluate('path => sharpforge.getEditorState(path)', path)
    for path, before in expected.items():
        page.evaluate('path => sharpforge.openFile(path)', path)
        after = page.evaluate('path => sharpforge.getEditorState(path)', path)
        for key in ['value', 'keymap', 'start', 'end', 'undo']:
            assert before[key] == after[key], f'{path}: lost {key}'
        assert page.evaluate('p => sharpforge.getBreakpoints()[p][0].line', path) == 7
    return {'scope': 'Two local edited buffers and explicit global designer connections',
            'documents': expected, 'breakpoints': page.evaluate('sharpforge.getBreakpoints()'),
            'perDocumentDesignerSessions': 'blocked: SF-A18-T01'}


def geometry(page, output):
    browser = page.context.browser
    captures = []
    for dpr in [1, 2]:
        for width in [1440, 800]:
            for theme in ['dark', 'light']:
                context = browser.new_context(viewport={'width': width, 'height': 1000}, device_scale_factor=dpr)
                try:
                    target = context.new_page()
                    errors = []
                    target.on('pageerror', lambda error: errors.append(str(error)))
                    target.goto(page.url)
                    wait_condition(target, 'window.sharpforge && sharpforge.getState().metrics !== null')
                    if target.evaluate('document.documentElement.dataset.theme') != theme:
                        target.evaluate('() => sharpforge.execute("theme")')
                    assert target.evaluate('devicePixelRatio') == dpr
                    button = target.locator('.toolbar [data-command="designer"]')
                    button.focus()
                    button.press('Enter')
                    wait_condition(target, 'sharpforge.designer.get().document != null')
                    bounds = button.evaluate('''element => {
                      const b=element.getBoundingClientRect();
                      return {button:{x:b.x,y:b.y,width:b.width,height:b.height},
                        children:[...element.children].map(child=>{const r=child.getBoundingClientRect();
                          return {x:r.x,y:r.y,width:r.width,height:r.height,center:r.y+r.height/2};}),
                        center:b.y+b.height/2, theme:document.documentElement.dataset.theme};
                    }''')
                    name = f'designer-{theme}-{width}-dpr{dpr}.png'
                    target.screenshot(path=str(output / name))
                    assert bounds['button']['height'] >= 24, str(bounds)
                    assert len(bounds['children']) >= 2, 'Designer label or glyph missing'
                    assert all(abs(child['center'] - bounds['center']) <= 2 for child in bounds['children']), str(bounds)
                    button.focus()
                    button.press('Tab')
                    focus = target.evaluate('''() => {const e=document.activeElement,r=e.getBoundingClientRect();
                      return {tag:e.tagName,width:r.width,height:r.height,outline:getComputedStyle(e).outlineStyle};}''')
                    assert focus['tag'] not in ['BODY', 'HTML'] and focus['width'] > 0 and focus['height'] > 0, str(focus)
                    assert not errors, str(errors)
                    name = f'designer-{theme}-{width}-dpr{dpr}.png'
                    target.screenshot(path=str(output / name))
                    captures.append({'theme': theme, 'viewportWidth': width, 'emulatedDpr': dpr,
                                     'bounds': bounds, 'keyboardFocus': focus, 'screenshot': name})
                finally:
                    context.close()
    return {'scope': 'Chromium emulated DPI; physical DPI and other engines remain unqualified', 'captures': captures}
