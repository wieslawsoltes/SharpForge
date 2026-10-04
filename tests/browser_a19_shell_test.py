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
        page.evaluate("""async () => {
          for (let turn = 0; turn < 5; turn++) {
            for (const dialog of [...sharpforge.workbenchShell.dialogs.stack]) dialog.cancel();
            await Promise.resolve();
          }
        }""")
        shell = "window.sharpforge.workbenchShell"

        page.locator('.sf-input').first.focus()
        page.keyboard.press('Alt+f')
        require(page.locator('.wb-menu-popup[aria-label="File"]').is_visible(), "Alt mnemonic did not open File")
        page.keyboard.press('ArrowRight')
        require(page.locator('.wb-menu-popup[aria-label="Edit"]').is_visible(), "Menu arrow navigation failed")
        page.keyboard.press('Escape')
        require(page.evaluate('!!document.activeElement.closest(".sf-editor")'), "Menu Escape failed to restore editor focus")
        evidence.append({"scenario": "menu-mnemonics-arrows-focus-restore", "passed": True})

        page.evaluate(f"{shell}.execute('workbench.options')")
        dialog = page.get_by_role("dialog", name="Options", exact=True)
        require(dialog.is_visible(), "Options dialog did not mount")
        page.get_by_role("textbox", name="Search options", exact=True).fill("keyboard")
        page.keyboard.press('ArrowDown')
        require(page.get_by_role("treeitem", name="Keyboard", exact=True).evaluate('node => node === document.activeElement'),
                "Filtered Options tree is unreachable by keyboard")
        page.keyboard.press('Enter')
        require(page.get_by_role("textbox", name="Press shortcut keys").is_visible(), "Keyboard page did not mount")
        before = page.evaluate(f"{shell}.settings.snapshot()")
        page.keyboard.press("Escape")
        require(page.evaluate(f"{shell}.settings.snapshot()") == before, "Cancel mutated settings")
        evidence.append({"scenario": "searchable-options-cancel", "passed": True})

        for theme in ['dark', 'light', 'blue', 'high-contrast']:
            ratios = page.evaluate("""theme => {
              sharpforge.workbenchShell.settings.apply({environment: {theme}});
              const style = getComputedStyle(document.documentElement);
              const rgb = variable => {
                const value = style.getPropertyValue(variable).trim();
                if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Unexpected theme color: ' + value);
                return [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255);
              };
              const luminance = value => {
                const channels = value.map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
                return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
              };
              return [['--wb-fg', '--wb-panel'], ['--wb-fg', '--wb-raised'], ['--wb-fg', '--wb-selected'],
                ['--wb-muted', '--wb-panel']].map(([foreground, background]) => {
                const first = luminance(rgb(foreground)), second = luminance(rgb(background));
                return {foreground, background, ratio: (Math.max(first, second) + .05) / (Math.min(first, second) + .05)};
              });
            }""", theme)
            require(all(pair['ratio'] >= 4.5 for pair in ratios), f"Insufficient shell text contrast for {theme}: {ratios}")
            evidence.append({"scenario": "theme-text-contrast", "theme": theme, "ratios": ratios, "passed": True})

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
