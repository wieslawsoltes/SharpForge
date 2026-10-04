# Project 16 editor browser corrections

This complete source batch starts from public main
`e4629f443b59bfc2d7494b731be19afc5974b7b1`, the source of
[hosted Chromium run 37172716850](https://github.com/wieslawsoltes/SharpForge/actions/runs/37172716850).
The run executed all eight registered functional suites. Docking, shell and
lazy-tool suites passed; sessions, workflows and the three editor suites failed.
This batch owns only the three editor failures. It does not replace those
retained failed outcomes with a source-review claim of browser success.

## Evidence and corrections

- **Quick Info:** the retained Playwright `queryCount` result was `2`. Both the
  tooltip's `Show potential fixes` button and the editor's separate
  `Show potential fixes and refactorings` lightbulb matched the substring role
  locator. The assertion now requires exactly one exact-name button inside
  Quick Info. It additionally clicks that button and requires the actual code
  action popup to open and the tooltip to close. The original diagnostic and
  safe-documentation assertions remain.
- **Rename:** after the first successful live preview, an ordinary background
  language request copied the temporary version into the monotonic compiler
  workspace. Restoring the original model checkpoint could not roll that
  external workspace back. The trace records `SFED1110: Stale or unversioned
  workspace edit: Widget.cs` after the comments/strings options changed.
  Inline rename now owns a scoped insight-request suspension. Starting the
  preview cancels outstanding requests, background requests do not enter
  providers during the session, and rename queries run only after restoring
  the original source. Commit, cancellation and disposal release the
  suspension. Version/stale checks remain intact. The browser still requires
  exact comment/string preview text, original UTF-16/CRLF bytes on cancellation,
  original version and no undo entry.
- **View fixture:** the HTML element `id="editor"` creates a named `window.editor`
  before the fixture's editor exists. Optional chaining did not make that
  element's nonexistent `dispose` callable. The fixture now retains explicitly
  owned editor, model and service instances and disposes only those instances.
  Both real-editor suites wait for their setup function and an actual model,
  rather than a merely defined named global. `setupView` and `window.editor`
  remain available to the shared budget fixture.

## Focused regression scope

`tests/a20-rename-preview-isolation.test.js` adds four cases using the actual
rename widget, request guard, persistent editor model, monotonic compiler
workspace and bound language/refactoring providers. Only DOM layout is doubled.
The cases cover repeated option changes with an intervening background request,
exact cancellation, one-transaction commit/undo, pending request cancellation,
independent idempotent suspension leases, and disposal restoration.

No tests, build or browser execution were run while implementing this batch.
The complete correction cohort and affected hosted editor suites are pending
the integration owner's serial qualification. Native IME, physical clipboard,
screen-reader and desktop-editor oracle results are unaffected by these source
corrections.
