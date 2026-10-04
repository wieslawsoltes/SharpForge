# Docking workspace

**Project 16 update:** [Current document groups, schema v2, window commands and platform contracts](a19-docking-workbench.md). Historical release notes below describe the earlier host; the linked capability inventory is authoritative for the new workbench.

**0.8 update:** See [Explorer, menus, editor profiles and breakpoint workflows](explorer-keymaps.md) and [current validation](validation-0.8.0.md). Earlier feature sections below remain applicable within their stated limits.

All 22 tools now have independent persistent content and docking identities: Solution Explorer, Diagnostic Tools, Output, Error List, Locals, Watch, Call Stack, Breakpoints, Assembly Explorer, IL Compiler Output, Managed Heap, Object Inspector, Generated Sources, Generators & Analyzers, Find All References, Call Hierarchy, Document Outline, Find in Files, Project Properties, Examples and Window Layouts. Confirmation/refactoring previews remain dialogs, rather than being permanent tools.

## Arrange your workspace

Drag a tab to a group's center to join it, or an edge/compass arrow to split horizontally or vertically. Drop onto a tab to reorder. Splitters resize by pointer or arrow keys. The tab strip supports arrow/Home/End navigation, scrolling on overflow and Shift+F10 for the window menu. Empty document groups remain drop targets; close/open individual tools via the tab menu or Window menu.

Double-click a tab or choose **Float in workspace** to create a movable/resizable in-page window. The window menu also provides explicit root-edge docking and group joining. Tool windows can auto-hide on edge shelves; activate a shelf, use Escape to dismiss, or pin it to dock again. Document tabs do not auto-hide.

Each file uses its own editor instance. Splitting, redocking, changing active tools or moving a file to another browser window retains that file's buffer, undo history, caret and listeners. Compiler/refactoring edits propagate to all affected visible editors. Debug sessions make every editor read-only, including undo and popouts.

## Separate browser windows

The window menu's **Open separate browser window** works for tools and source documents. It moves the actual content element to a same-origin child window, retaining its event listeners and the existing compiler/runtime workers. Output continues updating, document edits update the same project, and build/debug shortcuts can be forwarded to the main host. **Return to main workspace** or closing the child reattaches it. Forced browser closure is detected by a host-side watcher while windows are open.

This requires browser popup permission and an open main application. It is not independent multi-window application processes or arbitrary cross-origin collaboration. OS window coordinates are not saved; reloading a layout restores panel slots in the main page, not separate OS windows. CSS and theme are copied from the host. Multiple full applications in different browser tabs do not merge edits or layouts.

## Layout persistence and small screens

Window → Window Layouts includes coding/debugging/decompilation presets, layout undo, named layouts, and JSON import/export. The last valid tree and named snapshots use best-effort local storage. Restore validates panel identities and geometry before applying. Named window layouts now restore tool placement across document sets while keeping all currently open documents. Strict raw layout import still rejects invalid identities; persisted layout recovery reports dropped unknown identities.

At widths at or below 700 CSS pixels, common left/right tools become auto-hide shelves; the temporarily auto-hidden tools return to their original identity anchors when widening, preserving document changes made in the meantime. Floating windows clamp to the viewport. This is not touch-qualified, screen-reader-qualified or pixel-exact Visual Studio parity. Live split/tab/floating/popout interactions have browser acceptance tests; browser-native persistent storage and native filesystem permission UI were not qualified in the restricted local test environment.

## Reuse

The headless `DockLayout` model and `DockHost` DOM adapter are independently packaged as `@sharpforge/docking`, with no dependency on Studio or compiler packages. `DockLayout.validate()` enforces one placement per panel, finite sizes, active-tab validity, and node/depth/floating-group budgets. See the package README for a runnable embedding pattern.

0.5 adds the independent MSIL Disassembly panel (`disassembly`). It follows the selected direct-CIL stack frame and retains its worker session through docking/floating moves. IL Compiler Output remains the source compiler artifact view.

0.6 preserves tab-strip scroll positions and reveals the selected caption on layout/activation without scrolling the surrounding document. Ordinary-IL history controls and managed write breakpoints are integrated into existing docking tools.
