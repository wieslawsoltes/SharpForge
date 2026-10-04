"""Mounted workbench accessibility and virtual-grid checks; no compiler/runtime mocks."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_harness import load_application
from conformance.browser.launch import launch_browser, results_dir


def require(value, message):
    if not value:
        raise AssertionError(message)


def run():
    evidence = []
    with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
        page = browser.new_page(viewport={"width": 1440, "height": 960})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        load_application(page)
        page.wait_for_function("!!window.sharpforge?.workbenchShell")
        page.evaluate("window.sharpforge.workbenchShell.dialogs.stack.slice().forEach(d => d.cancel())")
        shell = "window.sharpforge.workbenchShell"

        page.evaluate(f"{shell}.execute('workbench.options')")
        dialog = page.get_by_role("dialog", name="Options", exact=True)
        require(dialog.is_visible(), "Options dialog did not mount")
        page.get_by_role("textbox", name="Search options", exact=True).fill("keyboard")
        page.get_by_role("treeitem", name="Keyboard", exact=True).click()
        require(page.get_by_role("textbox", name="Press shortcut keys").is_visible(), "Keyboard page did not mount")
        before = page.evaluate(f"{shell}.settings.snapshot()")
        page.keyboard.press("Escape")
        require(page.evaluate(f"{shell}.settings.snapshot()") == before, "Cancel mutated settings")
        evidence.append({"scenario": "searchable-options-cancel", "passed": True})

        for tool in ["problems", "output", "task-list", "class-view", "object-browser", "bookmarks",
                     "code-definition", "references", "test-explorer", "command-window"]:
            page.evaluate(f"id => {shell}.activateTool(id)", tool)
            page.wait_for_selector(f'[data-tool="{tool}"]:not([aria-busy="true"])')
            require(page.locator(f'[data-tool="{tool}"]').is_visible(), f"Tool {tool} is not visible")
        evidence.append({"scenario": "tool-window-mounts", "passed": True})

        page.evaluate(f"{shell}.execute('workbench.options')")
        page.set_viewport_size({"width": 320, "height": 640})
        bounds = page.get_by_role("dialog", name="Options", exact=True).bounding_box()
        require(bounds["x"] >= 0 and bounds["width"] <= 320, "Dialog clips at 320px")
        page.keyboard.press("Shift+Tab")
        require(page.evaluate("document.activeElement.closest('[role=dialog]') !== null"), "Focus escaped dialog")
        page.keyboard.press("Escape")
        page.set_viewport_size({"width": 1440, "height": 960})
        page.emulate_media(forced_colors="active", reduced_motion="reduce")
        page.evaluate(f"{shell}.execute('workbench.options')")
        require(page.get_by_role("dialog", name="Options", exact=True).is_visible(), "Forced colors hid dialog")
        page.keyboard.press("Escape")
        evidence.append({"scenario": "narrow-dialog-focus-forced-colors", "passed": True})

        page.evaluate(f"{shell}.activateTool('problems')")
        count = page.locator('[data-tool="problems"] .wb-grid-row').count()
        require(count < 100, "Diagnostic grid did not virtualize DOM")
        serious = page.evaluate("""() => [...document.querySelectorAll('.wb-tool button,.wb-dialog button,.wb-menubar button')]
          .filter(node => !node.hidden && !node.closest('[hidden]') && !node.textContent.trim() &&
            !node.getAttribute('aria-label') && !node.getAttribute('title')).length""")
        require(serious == 0, "Shell contains unnamed accessible buttons")
        require(not errors, "Browser errors: " + repr(errors))
        evidence.append({"scenario": "named-controls-and-bounded-grid", "passed": True})
        destination = results_dir() / "a19-shell-results.json"
        destination.write_text(json.dumps({"target": "browser", "checks": evidence}, indent=2))
        print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    run()
