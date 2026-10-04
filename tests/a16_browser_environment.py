"""Real browser raster/text scale and accessibility preference scenarios for the A16 gate."""


def require(value, message):
    if not value:
        raise AssertionError(message)


def text_scale_and_preferences(page, results):
    initial = page.evaluate('a16.managedResponsive()')
    page.evaluate('''async()=>{const r=a16.records.get('main');r.services.textScale.setFactor(2);await r.app.settled()}''')
    scaled = page.evaluate('a16.managedResponsiveState()')
    require(scaled['environment']['TextScaleFactor'] == 2, 'Text scaling was not published to the environment')
    require(scaled['environment']['RasterizationScale'] == initial['environment']['RasterizationScale'], 'Text scaling changed raster scale')
    require(scaled['button']['height'] > initial['button']['height'], 'Automatic button height did not respond to larger text')
    require(scaled['text']['y'] >= scaled['button']['y'] + scaled['button']['height'], 'Text scaling overlapped adjacent managed slots')
    old_font = float(initial['buttonFont'].removesuffix('px'))
    new_font = float(scaled['buttonFont'].removesuffix('px'))
    require(new_font >= old_font * 1.9, 'Native text styling did not follow managed measurement scaling')
    page.emulate_media(forced_colors='active', reduced_motion='reduce')
    page.wait_for_function('!a16.records.get("main").services.environment.AnimationsEnabled')
    state = page.evaluate('a16.managedResponsiveState()')
    forced_colors = page.evaluate('matchMedia("(forced-colors: active)").matches')
    if forced_colors:
        require(state['environment']['HighContrast'], 'Forced-color browser state was not propagated')
        palette = state['environment']['SystemColors']
        require(palette['Canvas'] != palette['CanvasText'], 'Forced-color palette lost text/background distinction')
    else:
        palette = None
    pane = state['environment']['InputPaneOccludedRect']
    if not state['inputPaneCapability']:
        require(pane == {'X': 0, 'Y': 0, 'Width': 0, 'Height': 0}, 'Unavailable virtual-keyboard geometry was fabricated')
    page.evaluate('a16.managedScrolling()')
    motion = page.evaluate('''async()=>{const r=a16.records.get('main'),C=r.C;r.events.length=0;
      const id=r.scroll.ScrollTo(0,400,new C.ScrollingScrollOptions(C.ScrollingAnimationMode.Auto));
      await r.app.settled();return {id,events:r.events,offset:r.scroll.VerticalOffset}}''')
    require(motion['offset'] == 400, 'Reduced-motion scroll did not reach its target')
    require(not any(event['name'] == 'ViewChanged' and event['intermediate'] for event in motion['events']),
            'Reduced-motion Auto scroll still animated')
    page.emulate_media(forced_colors='none', reduced_motion='no-preference')
    results['regressions'].append({'scope': 'A16-T11.2/T11.3/T11.4', 'textScale': 2,
                                   'forcedColors': {'status': 'passed' if forced_colors else 'unsupported', 'palette': palette},
                                   'motion': 'Auto uses actual browser reduced-motion preference',
                                   'inputPane': {'capability': state['inputPaneCapability'], 'observedRect': pane,
                                                 'nativeKeyboardPresentation': 'unqualified in headless browser'}})


def raster_scale(browser, install, scene, results):
    samples = []
    for requested in [1, 1.25, 1.5, 1.75, 2, 3, 4]:
        context = browser.new_context(viewport={'width': 800, 'height': 600}, device_scale_factor=requested)
        try:
            page = context.new_page()
            install(page)
            page.evaluate('scene=>a16.mount(scene)', scene)
            sample = page.evaluate('''()=>{const r=a16.records.get('main');return {actual:devicePixelRatio,
              scale:r.services.environment.RasterizationScale,rectangles:['round-grid','round-a','round-b'].map(id=>a16.geometry(id).layout)}}''')
            require(abs(sample['actual'] - requested) < 0.001, 'Browser did not establish requested devicePixelRatio')
            require(abs(sample['scale'] - sample['actual']) < 0.001, 'XamlRoot raster scale is stale')
            for rectangle in sample['rectangles']:
                for edge in [rectangle['x'], rectangle['y'], rectangle['x'] + rectangle['width'], rectangle['y'] + rectangle['height']]:
                    physical = edge * sample['actual']
                    require(abs(physical - round(physical)) < 0.001, 'Managed grid edge was not rounded to a physical pixel')
            first, second = sample['rectangles'][1:]
            require(abs(first['x'] + first['width'] - second['x']) < 0.001, 'Adjacent star tracks contain a gap or overlap')
            samples.append({'requested': requested, **sample})
            page.evaluate('a16.dispose()')
        finally:
            context.close()
    results['regressions'].append({'scope': 'A16-T11.1/T02.3', 'browserRasterSamples': samples,
                                   'nativeOSDisplayScaling': 'separate qualification required'})


def touch_density(browser, install, results):
    context = browser.new_context(viewport={'width': 320, 'height': 568}, device_scale_factor=2, has_touch=True)
    try:
        page = context.new_page()
        install(page)
        state = page.evaluate('a16.managedResponsive(288,480)')
        require(state['environment']['TouchMode'], 'Trusted touch browser was not detected')
        require(state['button']['height'] >= 40 and state['button']['width'] >= 40, 'Automatic touch target is below 40 DIPs')
        page.locator('[data-sf-id="' + state['buttonId'] + '"]').tap()
        events = page.evaluate('a16.records.get("main").events')
        require(sum(event['name'] == 'Click' for event in events) == 1, 'Native touch tap did not invoke once')
        results['regressions'].append({'scope': 'A16-T11.5', 'viewport': [320, 568], 'trustedTouch': True,
                                       'buttonBounds': state['button'], 'rasterScale': state['environment']['RasterizationScale']})
        page.evaluate('a16.dispose()')
    finally:
        context.close()
