"""Production designer command components: theme, density, width and DPI geometry.

The isolated component fixture uses the shipped ESM and styles inside the real
Studio page. It is browser DOM qualification, not a native/CLR qualification.
"""
import json
import statistics
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_harness import load_application
from conformance.browser.launch import launch_browser, results_dir

RESULTS = results_dir()
REPORT = RESULTS / 'designer-chrome-geometry.json'
WIDTHS = (480, 800, 1400)
DENSITIES = ('default', 'compact')
THEMES = ('dark', 'light')
DPRS = (1, 1.5, 2)

FIXTURE = r"""async () => {
  const load = path => window.__sharpforgeTestImport ? window.__sharpforgeTestImport('/' + path) :
    import(new URL('./' + path, location.href));
  const {DesignerCommandBar} = await load('designer-command-bar.js');
  const {designerButton, decorateDesignerSync} = await load('designer-command-buttons.js');
  const fixture = document.createElement('div');
  fixture.dataset.geometryFixture = '';
  Object.assign(fixture.style, {position:'fixed',left:'16px',top:'16px',zIndex:'99999',padding:'12px',
    background:'var(--design-panel)',border:'1px solid var(--design-line)'});
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  for (const selector of ['[data-command="designer"]', '.sample-button']) {
    const original = document.querySelector(selector);
    if (original) toolbar.append(original.cloneNode(true));
  }
  fixture.append(toolbar);
  const panel = document.createElement('div');
  panel.className = 'sf-design-tool';
  Object.assign(panel.style, {height:'180px',position:'relative'});
  panel.innerHTML = '<div class="design-toolbar">' +
    ['new','open','save','download','undo','redo','fit','preview'].map(command =>
      `<button data-design-action="${command}">${command}</button>`).join('') +
    '<select aria-label="Editing mode"><option>Pixel editing</option></select>' +
    '<label>Snap <input type="number" value="8"></label></div>' +
    '<div class="design-toolbar">' + ['attach','apply','generate','source'].map(command =>
      `<button data-design-action="${command}">${command}</button>`).join('') + '</div>';
  fixture.append(panel);
  document.body.append(fixture);
  const modes = document.createElement('div');
  modes.className = 'design-mode-tabs';
  for (const label of ['Design','Split','C#','Preview']) {
    const button = document.createElement('button');
    button.textContent = label;
    button.setAttribute('aria-label', label);
    modes.append(button);
  }
  const sync = document.createElement('div');
  sync.className = 'design-sync-bar';
  sync.innerHTML = '<span class="design-sync-state">Synchronized</span>' +
    '<button data-sync="read">Read C#</button><button data-sync="write">Apply to C#</button>';
  decorateDesignerSync(sync);
  const bar = new DesignerCommandBar({panel:() => panel}, {modes,sync});
  const side = document.createElement('div');
  side.className = 'design-side';
  side.style.height = 'auto';
  side.innerHTML = '<details class="design-toolbox-category" open><summary><span>Common</span></summary>' +
    designerButton('layout','Grid','fixture-grid') + '</details>' +
    '<section class="design-source-link"><button data-sync="read">Read C#</button></section>';
  fixture.append(side);
  decorateDesignerSync(side);
  window.__designerGeometry = {fixture,panel,bar,toolbar};
  await document.fonts.ready;
}
"""

MEASURE = r"""() => {
  const {fixture,bar,toolbar} = window.__designerGeometry;
  const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
  const center = rectangle => rectangle.top + rectangle.height / 2;
  const rangeBounds = element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const bounds = [];
    let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim() || text.parentElement.closest('svg')) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      const rectangle = range.getBoundingClientRect();
      if (rectangle.width) bounds.push(rectangle);
    }
    if (!bounds.length) return null;
    const top = Math.min(...bounds.map(rectangle => rectangle.top));
    const bottom = Math.max(...bounds.map(rectangle => rectangle.bottom));
    return {top,bottom,height:bottom-top};
  };
  const controls = [...fixture.querySelectorAll('button,summary')].filter(visible);
  const geometry = controls.map(element => {
    const bounds = element.getBoundingClientRect();
    const text = rangeBounds(element);
    const svg = element.querySelector('svg');
    const label = element.querySelector('.design-command-label') ??
      [...element.children].find(child => child.tagName === 'SPAN' && !child.querySelector('svg') && child.textContent.trim());
    const iconOffset = svg && label ? Math.abs(center(svg.getBoundingClientRect()) - center(label.getBoundingClientRect())) : null;
    return {label:element.getAttribute('aria-label') || element.textContent.trim(),
      textOffset:text ? Math.abs(center(bounds)-center(text)) : null,
      iconOffset, height:bounds.height, font:getComputedStyle(element).fontSize,
      role:element.getAttribute('role'), tag:element.tagName};
  });
  const button = toolbar.querySelector('.toolbar-button');
  const sample = toolbar.querySelector('.sample-button');
  const rectangle = bar.element.getBoundingClientRect();
  const clipping = [...bar.primary.children].filter(visible).some(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.left < rectangle.left - .5 || bounds.right > bar.button.getBoundingClientRect().left + .5;
  });
  return {geometry, clipping, commandHeight:rectangle.height,
    designerHeight:button?.getBoundingClientRect().height, sampleHeight:sample?.getBoundingClientRect().height,
    focus:getComputedStyle(bar.button).outlineColor, allReachable:bar.items.length,
    syncFonts:[...fixture.querySelectorAll('.design-sync-bar button,.design-source-link button')].map(button => getComputedStyle(button).fontSize)};
}
"""


def require(value, message):
    if not value:
        raise AssertionError(message)


def inspect_case(page, width, density, theme, dpr):
    page.evaluate("""({width,density,theme}) => {
      const {fixture,panel,bar} = window.__designerGeometry;
      document.documentElement.dataset.theme = theme;
      fixture.dataset.designDensity = density;
      fixture.style.width = width + 'px';
      panel.style.width = width + 'px';
      bar.close(false);
      bar.layout();
    }""", {'width': width, 'density': density, 'theme': theme})
    result = page.evaluate(MEASURE)
    label = f'{width}px {density} {theme} DPR {dpr}'
    require(not result['clipping'], label + ': a primary command clips')
    require(result['commandHeight'] <= 40, label + ': command bar wrapped')
    require(result['allReachable'] == 14, label + ': a command was lost during consolidation')
    require(abs(result['designerHeight'] - result['sampleHeight']) <= .5, label + ': main toolbar height mismatch')
    for control in result['geometry']:
        require(control['label'], label + ': unnamed control')
        if control['iconOffset'] is not None:
            require(control['iconOffset'] <= .5, label + ': icon offset ' + str(control))
        if control['textOffset'] is not None:
            require(control['textOffset'] <= 1, label + ': text offset ' + str(control))
    page.evaluate('window.__designerGeometry.bar.button.focus()')
    page.keyboard.press('Enter')
    require(page.evaluate('window.__designerGeometry.bar.opened'), label + ': keyboard overflow did not open')
    overflow = page.evaluate(MEASURE)
    require(all(font == '11px' for font in overflow['syncFonts']), label + ': sync font regression')
    require(page.evaluate('window.__designerGeometry.bar.overflow.contains(document.activeElement)'), label + ': overflow focus missing')
    page.keyboard.press('Escape')
    require(page.evaluate('document.activeElement === window.__designerGeometry.bar.button'), label + ': focus not restored')
    screenshot = RESULTS / 'screenshots' / f'designer-{theme}-{density}-{width}-{dpr}.png'
    page.locator('[data-geometry-fixture]').screenshot(path=str(screenshot))
    return {'width': width, 'density': density, 'theme': theme, 'dpr': dpr, **result, 'screenshot': str(screenshot)}


def run():
    report = {'qualification': 'Production browser DOM components; native CLR is not exercised', 'cases': []}
    with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
        report['browserVersion'] = browser.version
        for dpr in DPRS:
            page = browser.new_page(viewport={'width': 1840, 'height': 1000}, device_scale_factor=dpr)
            try:
                load_application(page)
                page.evaluate(FIXTURE)
                page.evaluate("""() => {
                  const broken=document.createElement('button');
                  broken.dataset.brokenGeometry='';
                  broken.className='design-command';
                  broken.innerHTML='<svg class="icon" viewBox="0 0 16 16" style="transform:translateY(4px)"></svg>'+
                    '<span class="design-command-label">Broken baseline fixture</span>';
                  window.__designerGeometry.fixture.append(broken);
                }""")
                broken = next(item for item in page.evaluate(MEASURE)['geometry'] if item['label'] == 'Broken baseline fixture')
                require(broken['iconOffset'] > 1, 'geometry detector failed to reject the deliberately misaligned baseline')
                page.evaluate('document.querySelector("[data-broken-geometry]").remove()')
                for theme in THEMES:
                    for density in DENSITIES:
                        for width in WIDTHS:
                            report['cases'].append(inspect_case(page, width, density, theme, dpr))
                timings = page.evaluate("""() => {
                  const values = [];
                  for (let index=0;index<101;index++) {
                    const start=performance.now();
                    window.__designerGeometry.bar.layout();
                    values.push(performance.now()-start);
                  }
                  return values;
                }""")
                ordered = sorted(timings[1:])
                report.setdefault('layoutTimings', []).append({'dpr': dpr, 'coldMs': timings[0],
                    'warmMedianMs': statistics.median(ordered), 'p95Ms': ordered[94], 'p99Ms': ordered[98],
                    'allocations': 'Not exposed by the browser DOM API'})
                page.evaluate('window.__designerGeometry.bar.dispose(); window.__designerGeometry.fixture.remove()')
                require(page.locator('[data-geometry-fixture]').count() == 0, 'component disposal leaked the fixture')
            finally:
                page.close()
    REPORT.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(f'PASS designer geometry: {len(report["cases"])} theme/density/width/DPI cases; {REPORT}', flush=True)


if __name__ == '__main__':
    run()
