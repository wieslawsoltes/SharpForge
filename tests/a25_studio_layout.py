"""Real dock resizing and pointer reachability for the production history/detail panes."""


MEASURE = """() => {
    const tool = document.querySelector('[data-tool="git-repository"]');
    const main = tool?.querySelector('.git-repository-main');
    const detail = tool?.querySelector('.git-commit-detail');
    const history = tool?.querySelector('.git-history-viewport');
    const file = [...(detail?.querySelectorAll('.git-path') ?? [])].find(node => node.textContent.includes('Program.cs'));
    if (!main || !detail || !history || !file) return null;
    const box = file.getBoundingClientRect();
    const visible = { left: Math.max(0, box.left), top: Math.max(0, box.top),
      right: Math.min(innerWidth, box.right), bottom: Math.min(innerHeight, box.bottom) };
    for (let node = file.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node), bounds = node.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        visible.left = Math.max(visible.left, bounds.left + node.clientLeft);
        visible.right = Math.min(visible.right, bounds.left + node.clientLeft + node.clientWidth);
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        visible.top = Math.max(visible.top, bounds.top + node.clientTop);
        visible.bottom = Math.min(visible.bottom, bounds.top + node.clientTop + node.clientHeight);
      }
    }
    const width = Math.max(0, visible.right - visible.left), height = Math.max(0, visible.bottom - visible.top);
    const point = { x: (visible.left + visible.right) / 2, y: (visible.top + visible.bottom) / 2 };
    const hit = width && height ? document.elementFromPoint(point.x, point.y) : null;
    return { dockHeight: tool.closest('[data-dock-group]').getBoundingClientRect().height,
      mainClientHeight: main.clientHeight, mainScrollHeight: main.scrollHeight, mainOverflow: getComputedStyle(main).overflowY,
      historyClientHeight: history.clientHeight, detailClientHeight: detail.clientHeight,
      fileHeight: box.height, visibleFileHeight: height, visibleFileWidth: width, point,
      hitTarget: !!hit && (hit === file || file.contains(hit)), interceptedBy: hit?.className ?? null };
}"""


def _resize_dock(page, history, height):
    splitter = page.locator('[data-split-id="split-bottom"] > .sf-dock-divider')
    bounds = splitter.bounding_box()
    current = history.evaluate("node => node.closest('[data-dock-group]').getBoundingClientRect().height")
    x, y = bounds["x"] + bounds["width"] / 2, bounds["y"] + bounds["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x, y + current - height, steps=5)
    page.mouse.up()
    page.wait_for_function("""height => {
        const tool = document.querySelector('[data-tool="git-repository"]');
        return Math.abs(tool.closest('[data-dock-group]').getBoundingClientRect().height - height) < 8;
    }""", arg=height)


def _reachable_file(page, history):
    history.locator('.git-commit-detail .git-path').filter(has_text="Program.cs").scroll_into_view_if_needed()
    try:
        return page.wait_for_function("""() => {
            const value = (""" + MEASURE + """)();
            return value && value.detailClientHeight >= 56 && value.historyClientHeight >= 128
              && ['auto', 'scroll'].includes(value.mainOverflow) && value.visibleFileWidth > 0
              && value.visibleFileHeight >= Math.min(28, value.fileHeight) - 1 && value.hitTarget ? value : false;
        }""")
    except Exception as error:
        raise AssertionError(f"History file is clipped or covered: {page.evaluate(MEASURE)}") from error


def qualify_history_layout(page, history):
    """Use trusted splitter drags; never patch page styles or bypass the ordinary file click."""
    original = history.evaluate("node => node.closest('[data-dock-group]').getBoundingClientRect().height")
    measurements = []
    try:
        for label, height in [("standard", 320), ("short", 200)]:
            _resize_dock(page, history, height)
            measurements.append({"size": label, "requestedDockHeight": height, **_reachable_file(page, history)})
    finally:
        _resize_dock(page, history, original)
    measurements.append({"size": "restored", "requestedDockHeight": original, **_reachable_file(page, history)})
    return measurements
