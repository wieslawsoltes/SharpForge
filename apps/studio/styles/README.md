# Studio tool styles

These files own the Studio workbench and tool styling. Their order is declared in
`../build.contrib.json`; package-owned editor, controls and WinUI styles remain
in their package contributions.

The initial extraction preserves every source byte and the existing cascade.
Each file is a contiguous segment of the previous bundle, including whitespace.
An empty `separator` joins adjacent segments directly; omitted separators retain
the normal newline between stylesheets. Do not group later overrides into an
earlier file merely because they share a selector: that can change which rule
wins. Contribution orders leave gaps between groups for future tool additions.

| Surface | Files |
| --- | --- |
| Shared workbench | `workbench-theme`, `workbench-responsive`, `workbench-density`, `workbench-light` |
| Explorer and dialogs | `solution-explorer`, `explorer-dialogs`, `project-wizard` |
| Workbench controls | `context-menus`, `docking`, `status-bar`, `property-grid`, `settings` |
| Editor integration | `editor-theme`, `editor-overlays` |
| Debugger tools | `debugger`, `debugger-advanced`, `debugger-parallel`, `debugger-effects`, `debugger-responsive` |
| App and symbols tools | `winui-app`, `symbols` |
| Designer | `designer`, `designer-sync`, `designer-light` |
| Runtime settings | `runtime-settings` |

Names above have the `.css` extension. Shared responsive blocks retain their
original grouping, including rules affecting more than one related tool.
`tests/a00-20-styles.test.js` checks source registration, byte identity, sorted
rules, and ordered rules against the reviewed fingerprint. Intentional
future appearance changes should update that reviewed fixture with their own
browser evidence.

A18 retains `designer.css` and `designer-light.css` at their original contribution
positions as exact comment-only compatibility shims. Their surface and panel
rules now live in `../designer-surface.css` and `../designer-panels.css`; shared
light and dark color tokens live in `../workbench/theme-tokens.css`; command
geometry tokens stay in `../designer-chrome.css`. Blue, High Contrast and forced
colors follow the shared workbench palette. The style contract
pins both shim contents, requires those replacements to be registered and contain
rules, and continues to require rules in every other extracted fragment. The
aggregate byte and rule fingerprints still cover every contributed stylesheet
and its cascade order.

The original A19 theme-migration receipt remains unchanged. Its three deliberately
replaced designer fragments have explicit predecessor and successor fingerprints
in `studio-designer-successor.json`; A18 geometry and theme cases cover the new
behavior. Designer document, property and chrome contributions follow the shared
workbench/theme contributions at orders 13000–13004, without reusing their orders.
