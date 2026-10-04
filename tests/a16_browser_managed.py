"""Authored public-API browser scenarios; imported by the consolidated A16 gate."""


def require(value, message):
    if not value:
        raise AssertionError(message)


def node(page, identity):
    return page.locator('[data-a16-root="main"] [data-sf-id="' + identity + '"]')


def template_input(page, results):
    page.mouse.move(800, 700)
    ids = page.evaluate('a16.managedTemplates()')
    node(page, ids['border']).click(position={'x': 3, 'y': 3})
    state = page.evaluate('a16.managedTemplateState()')
    clicks = [event for event in state['events'] if event['name'] == 'Click']
    require(clicks == [{'name': 'Click', 'sender': ids['route'], 'original': ids['border']}],
            'Templated inner-border click lost its original source, sender, or exact-once delivery')
    box = node(page, ids['stateButton']).bounding_box()
    page.mouse.move(box['x'] + 20, box['y'] + 20)
    page.wait_for_function('a16.managedTemplateState().states.CommonStates === "PointerOver"')
    page.mouse.down()
    state = page.evaluate('a16.managedTemplateState()')
    require(state['pressed'] and state['states']['CommonStates'] == 'Pressed', 'Native press did not update the managed current state')
    pressed = [event for event in state['events'] if event['name'] == 'PointerPressed']
    require(pressed[-1]['pressed'] and pressed[-1]['state'] == 'Pressed', 'State was published after the PointerPressed callback')
    page.mouse.up()
    page.wait_for_function('a16.managedTemplateState().states.CommonStates === "PointerOver"')
    page.evaluate('async()=>{const r=a16.records.get("main");r.stateButton.IsEnabled=false;await r.app.settled()}')
    require(page.evaluate('a16.managedTemplateState().states.CommonStates') == 'Disabled', 'Disabled state was not applied')
    page.evaluate('async()=>{const r=a16.records.get("main");r.stateButton.IsEnabled=true;await r.app.settled()}')
    page.locator('[data-a16-before="main"]').focus()
    for _ in range(20):
        page.keyboard.press('Tab')
        if page.evaluate('a16.records.get("main").host.focusManager.focusedElement') == ids['stateButton']:
            break
    state = page.evaluate('a16.managedTemplateState()')
    require(state['focusState'] == 2 and state['states']['FocusStates'] == 'Focused', 'Native Tab did not reach managed keyboard focus')
    native_capture(page, ids['stateButton'], results)
    results['regressions'].append({'issues': [1809, 1819], 'managedTemplateParts': True,
                                   'input': ['pointer', 'keyboard', 'disabled'], 'exactOriginalSource': True})


def native_capture(page, identity, results):
    page.evaluate('()=>{const r=a16.records.get("main");r.captureNext=true;r.events.length=0}')
    box = node(page, identity).bounding_box()
    page.mouse.move(box['x'] + 20, box['y'] + 20)
    page.mouse.down()
    page.mouse.move(box['x'] + box['width'] + 80, box['y'] + 20)
    page.mouse.up()
    events = page.evaluate('a16.managedTemplateState().events')
    require(any(event['name'] == 'CaptureResult' and event['value'] for event in events), 'Native pointer capture was refused')
    moves = [event['point'] for event in events if event['name'] == 'CapturedMove']
    require(any(point['X'] > box['width'] for point in moves), 'Captured pointer did not continue outside the managed bounds')
    require(sum(event['name'] == 'CaptureLost' for event in events) == 1, 'Capture loss must be delivered once')
    results['regressions'].append({'scope': 'A16-T04.2', 'trustedMouseCapture': True})


def scrolling(page, results):
    ids = page.evaluate('a16.managedScrolling()')
    initial = page.evaluate('a16.managedScrollState()')
    require(initial['controller']['canScroll'] and initial['extent'] >= 1000, 'Real presenter/controller extent is missing')
    require(len(initial['templates']['labels']) == 4, 'LabelTemplate did not generate four managed containers')
    require(len({value['$ref'] for value in initial['templates']['labels']}) == 4, 'Mutable label visuals were shared')
    box = node(page, ids['presenter']).bounding_box()
    page.mouse.move(box['x'] + 40, box['y'] + 40)
    page.mouse.wheel(0, 60)
    page.wait_for_function('a16.managedScrollState().offset > 0')
    animation = page.evaluate('''async()=>{
      const r=a16.records.get('main'), C=r.C;r.events.length=0;
      const options=new C.ScrollingScrollOptions(C.ScrollingAnimationMode.Enabled,C.ScrollingSnapPointsMode.Ignore);
      const id=r.scroll.ScrollTo(0,260,options), samples=[];
      for(let frame=0;frame<120;frame++){
        await new Promise(requestAnimationFrame);samples.push(r.scroll.VerticalOffset);
        if(r.events.some(e=>e.name==='ScrollCompleted'&&e.id===id))break;
      }
      await r.app.settled();return {id,samples,state:a16.managedScrollState()};
    }''')
    require(len(set(animation['samples'])) > 2, 'Enabled scroll animation produced no intermediate browser frames')
    events = animation['state']['events']
    completed = next(index for index, event in enumerate(events) if event['name'] == 'ScrollCompleted' and event['id'] == animation['id'])
    require(completed > 0 and events[completed - 1]['name'] == 'ViewChanged' and not events[completed - 1]['intermediate'],
            'Final ViewChanged must precede completion')
    require(abs(events[completed]['offset'] - 260) < 0.01, 'Completion callback read stale offset metrics')
    before_zoom = page.evaluate('a16.managedScrollState().zoom')
    page.keyboard.down('Control')
    page.mouse.wheel(0, -120)
    page.keyboard.up('Control')
    page.wait_for_function('before=>a16.managedScrollState().zoom>before', arg=before_zoom)
    pointer_pinch(page, ids['presenter'])
    annotated(page, ids['bar'])
    require(not page.evaluate('a16.errors'), 'Scroll or annotated rendering faulted')
    results['regressions'].append({'scope': 'A16-T18/T19/T22', 'trustedWheel': True, 'trustedCtrlWheel': True,
                                   'pinch': 'synthetic browser PointerEvent stream', 'frameSamples': len(animation['samples']),
                                   'managedLabelTemplates': 4, 'cancelableAnnotation': True, 'managedDetailTemplate': True})


def pointer_pinch(page, identity):
    result = page.evaluate('''id=>{
      const r=a16.records.get('main'), element=r.host.elements.get(id), b=element.getBoundingClientRect();
      const before=r.scroll.ZoomFactor;
      const emit=(type,pointerId,x,y)=>element.dispatchEvent(new PointerEvent(type,{pointerId,pointerType:'touch',
        isPrimary:pointerId===91,bubbles:true,cancelable:true,buttons:type==='pointerup'?0:1,clientX:b.x+x,clientY:b.y+y}));
      emit('pointerdown',91,50,60);emit('pointerdown',92,110,60);
      emit('pointermove',92,170,60);emit('pointerup',92,170,60);emit('pointerup',91,50,60);
      return {before,after:r.scroll.ZoomFactor};
    }''', identity)
    require(result['after'] > result['before'], 'Two-pointer distance change did not zoom the shared viewport')


def annotated(page, identity):
    root = node(page, identity)
    page.evaluate('a16.records.get("main").cancelAnnotated=true')
    before = page.evaluate('a16.managedScrollState().offset')
    root.locator('[data-annotated-label="0"]').click()
    page.wait_for_function('a16.managedScrollState().events.some(e=>e.name==="Scrolling"&&e.cancel)')
    require(abs(page.evaluate('a16.managedScrollState().offset') - before) < 0.01, 'Canceled annotation changed the view')
    page.evaluate('a16.records.get("main").cancelAnnotated=false')
    root.locator('[data-annotated-label="1"]').click()
    page.wait_for_function('Math.abs(a16.managedScrollState().offset-250)<0.01')
    page.evaluate('a16.records.get("main").app.settled()')
    state = page.evaluate('a16.managedScrollState()')
    require(abs(state['controller']['value'] - state['offset']) < 0.01, 'Annotated controller did not receive actual scroll feedback')
    box = root.bounding_box()
    page.mouse.move(box['x'] + 10, box['y'] + 80)
    page.wait_for_function('''()=>{const r=a16.records.get('main'), part=r.root.querySelector('[data-annotated-detail]');
      return part&&!part.hidden&&part.textContent.includes('Managed detail')}''')
    page.evaluate('a16.records.get("main").app.settled()')
    require(page.evaluate('a16.managedScrollState().templates.detail !== null'), 'DetailLabelTemplate has no managed identity')


def expander(page, results):
    ids = page.evaluate('a16.managedExpander()')
    state = page.evaluate('a16.managedExpanderState()')
    require(ids['header'] and ids['content'] and 'Templated header' in state['text'], 'Expander named/template header was not generated')
    collapsed_height = state['height']
    header = node(page, ids['id']).locator('[data-expander-header]')
    header.focus()
    page.keyboard.press('Space')
    page.wait_for_function('a16.managedExpanderState().expanded')
    page.evaluate('a16.records.get("main").app.settled()')
    expanded = page.evaluate('a16.managedExpanderState()')
    require(expanded['height'] > collapsed_height and expanded['content']['height'] >= 70, 'Expanding did not allocate the real content slot')
    require(expanded['ariaExpanded'] == 'true' and 'Templated body' in expanded['text'], 'Template content or expanded semantics were lost')
    page.evaluate('async()=>{const r=a16.records.get("main");r.expander.ExpandDirection=r.C.ExpandDirection.Up;await r.app.settled()}')
    up = page.evaluate('a16.managedExpanderState()')
    require(up['header']['y'] >= up['content']['y'] + up['content']['height'] - 1, 'Up expander did not place its header below content')
    header.focus()
    page.keyboard.press('Space')
    page.wait_for_function('!a16.managedExpanderState().expanded')
    page.evaluate('a16.records.get("main").app.settled()')
    state = page.evaluate('a16.managedExpanderState()')
    require(abs(state['height'] - collapsed_height) <= 1 and state['ariaExpanded'] == 'false', 'Collapse retained the expanded layout extent')
    require([event['name'] for event in state['events']] == ['Expanding', 'Collapsed'], 'Expander delivered duplicate lifecycle events')
    results['regressions'].append({'scope': 'A16-T20', 'templates': ['HeaderTemplate', 'ContentTemplate'],
                                   'directions': ['Down', 'Up'], 'nativeKeyboard': True})


def rich_overflow(page, fixture, results):
    page.evaluate('scene=>a16.mount(scene)', fixture['scene'])
    actual = page.evaluate('''()=>{const r=a16.records.get('main');return ['rich','overflow1','overflow2'].map(id=>{
      const element=r.host.elements.get(id);return {id,text:element.textContent,height:element.clientHeight,
        scrollHeight:element.scrollHeight,overflow:r.host.nodes.get(id).properties.HasOverflowContent};})}''')
    require(all(item['text'] for item in actual), 'A linked overflow container did not receive text')
    require(fixture['text'].startswith(''.join(item['text'] for item in actual)), 'Overflow splitting reordered or duplicated inline text')
    require(all(item['scrollHeight'] <= item['height'] + 1 for item in actual), 'A fitted overflow container still exceeds its height')
    require(actual[0]['overflow'] and actual[1]['overflow'], 'Overflow state was not propagated across the chain')
    results['regressions'].append({'scope': 'A16-T29', 'containers': actual, 'actualDOMRange': True})
