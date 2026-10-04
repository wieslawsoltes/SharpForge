"""Observe actual attribution rows against native editor DOM after real scrolling."""
import time


GEOMETRY = """() => {
    const editor = document.querySelector('[data-source-uri="Program.cs"]');
    const viewport = editor?.querySelector('.sf-viewport');
    if (!viewport) throw new Error('The actual native editor viewport is missing');
    const bounds = viewport.getBoundingClientRect();
    const sources = [...editor.querySelectorAll('.sf-view-line[data-line]')];
    const rows = [...editor.querySelectorAll('.git-blame-margin-row')].map(row => {
        const line = row.hasAttribute('data-line') ? Number(row.dataset.line) : null;
        const rect = row.getBoundingClientRect();
        const source = sources.find(value => Number(value.dataset.line) === line);
        const sourceRect = source?.getBoundingClientRect();
        return {line, top: rect.top, height: rect.height, label: row.textContent, title: row.title,
            sourceTop: sourceRect?.top ?? null, sourceHeight: sourceRect?.height ?? null,
            sourceText: source?.textContent ?? null};
    }).filter(row => row.top + row.height > bounds.top && row.top < bounds.bottom);
    return {scrollTop: viewport.scrollTop, viewportTop: bounds.top, viewportHeight: bounds.height, rows};
}"""


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def aligned_rows(value):
    return len(value["rows"]) >= 3 and all(
        row["line"] is not None and row["sourceTop"] is not None
        and abs(row["top"] - row["sourceTop"]) <= 1
        and abs(row["height"] - row["sourceHeight"]) <= 1
        for row in value["rows"]
    )


def wait_geometry(page, evidence, minimum_scroll=0):
    deadline = time.monotonic() + 30
    while True:
        value = page.evaluate(GEOMETRY)
        evidence["lastObservedGeometry"] = value
        if value["scrollTop"] >= minimum_scroll and aligned_rows(value):
            return value
        require(time.monotonic() < deadline,
                "Native blame labels did not align with the same logical source rows after scrolling")
        page.wait_for_timeout(16)


def qualify_blame_scroll(workflow):
    page = workflow.page
    original = workflow.editor_text()
    require(original.endswith('\n'), "The scroll fixture requires a line-terminated original source")
    original_lines = len(original.splitlines())
    added = [f'// blame-scroll-{index:03d}' for index in range(250)]
    extended = original + '\n'.join(added) + '\n'
    evidence = {"backend": "actual native editor viewport and rendered logical rows",
                "addedLines": len(added), "positionToleranceCssPx": 1, "restored": False}
    workflow.report["blameScrollGeometry"] = evidence
    opened = False
    try:
        workflow.edit(extended)
        page.evaluate('sharpforge.execute("git.blameMargin")')
        opened = True
        page.locator('[data-source-uri="Program.cs"] .git-blame-margin-row').first.wait_for(state="visible")
        viewport = page.locator('[data-source-uri="Program.cs"] .sf-viewport')
        viewport.evaluate('viewport => { viewport.scrollTop = 0; }')
        before = wait_geometry(page, evidence)
        evidence["before"] = before
        viewport.hover()
        # Scroll the real scroller through trusted browser input; no textarea event is manufactured.
        page.mouse.wheel(0, 617)
        after = wait_geometry(page, evidence, before["scrollTop"] + 100)
        evidence["after"] = after
        before_first = min(row["line"] for row in before["rows"])
        after_first = min(row["line"] for row in after["rows"])
        require(after_first > before_first, "Wheel scrolling did not advance the visible logical attribution rows")
        require(len({row["line"] for row in after["rows"]}) == len(after["rows"]),
                "Native blame rendered duplicate labels for a logical source row")
        for row in after["rows"]:
            offset = row["line"] - original_lines
            require(0 <= offset < len(added) and added[offset] in row["sourceText"],
                    "Scrolled source geometry did not identify the expected actual numbered source line")
            require(row["title"] == 'This line is not committed' and row["label"].startswith('0000000 '),
                    "Scrolled attribution label does not describe the actual uncommitted source line")
        workflow.screenshot("blame-scrolled")
        return evidence
    finally:
        try:
            if opened:
                page.evaluate('sharpforge.execute("git.blameMargin")')
                page.locator('[data-source-uri="Program.cs"] .git-blame-margin').wait_for(state="detached")
        finally:
            workflow.edit(original)
            restored = workflow.snapshot()
            require(workflow.editor_text() == original and restored["versions"]["working"]["text"] == original,
                    "The native scroll fixture did not restore and save the original workspace bytes")
            require(restored["head"]["oid"] == workflow.final_head,
                    "The native scroll fixture changed committed HEAD")
            evidence["restored"] = True
