# Development environment and ReSharper-like shortcuts

Work item: **SF-A19-T42 / #1478**.

The first-run dialog offers a theme and every supported native keyboard scheme,
including Visual Studio, Visual Studio Code, and **ReSharper-like (IntelliJ)**.
The new scheme's persisted identifier is `resharper`. Visual Studio remains the
default, and existing identifiers and settings version 2 retain their meaning.
The editor's public `EDITOR_KEYMAPS` and `getProfileBindings('resharper')` APIs
provide the same scheme to the editor, Studio, Options, and examples.

## Choosing, importing, and resetting

**Start coding** saves the selected theme and scheme in one settings transaction.
The existing shell subscription applies that scheme to every open editor view and
the shared global resolver. Workspace actions such as Go To All work when focus
is outside an editor, including when no document is active. Text edits remain in
the Text Editor scope. Registered command availability and custom bindings remain
effective after a profile change.

Use **Tools → Options → Environment → Keyboard → Mapping scheme** to change the
choice later. Options edits a detached draft; Cancel discards it. OK publishes
only edited preference keys. Choosing a scheme does not replace the document
model, reset its undo stack, or modify source text, selections, folds, or bookmarks.

**Import and Export Settings** supports three related operations:

- Import a previewed settings file for the selected categories.
- Choose the development environment again, even after first-run setup completed.
- Reset selected categories to defaults. Resetting Environment restores Visual
  Studio and the default theme and makes first-run setup available again.

Explicit user choices remove corresponding preference overrides in the current
workspace so an older override cannot hide the new choice. Other preference keys
and other workspace overrides remain intact. Reset removes current-workspace
overrides only for the selected categories. All updates persist before publishing
one change event; storage failure leaves the previous settings and shortcuts
active. Runtime grants and credentials remain outside exported settings.

The app settings contracts are `SettingsStore.apply(values,
{scope:'user', clearWorkspaceOverrides:true})` for explicit preference changes,
and `SettingsStore.reset(categories)` for selected-category reset. The ordinary
`apply(values)` overlay policy is unchanged. `showFirstRun({dialogs, settings,
force:true})` opens the chooser after completed setup.

## Supported ReSharper-like mappings

This is a native SharpForge preset based on the **IntelliJ column of ReSharper
2026.2**, not an extension host. On Windows/Linux, `Mod` is Ctrl; the portable Mac
mapping uses Command. The latter is SharpForge's platform convention, not a claim
of native ReSharper for macOS equivalence.

| Action in SharpForge | Reference gesture | Additional browser chord |
|---|---|---|
| Available code actions and refactorings | Alt+Enter; Ctrl+Shift+R | Existing Ctrl+. |
| Format document | Ctrl+Alt+L | — |
| Completion | Ctrl+Space | — |
| Parameter information | Ctrl+P | Ctrl+K, Ctrl+P |
| Quick information | Ctrl+Q | Ctrl+K, Ctrl+I |
| Insert snippet | Ctrl+J | — |
| Surround with snippet | Ctrl+Alt+J | — |
| Expand selection | Ctrl+W | Ctrl+K, Ctrl+W |
| Shrink selection | Ctrl+Shift+W | Ctrl+K, Ctrl+Shift+W |
| Duplicate selected text or lines | Ctrl+D | — |
| Join lines | Ctrl+Shift+J | — |
| Toggle line comment | Ctrl+/ | — |
| Toggle block comment | Ctrl+Shift+/ | — |
| Move selected lines | Ctrl+Alt+Shift+Up/Down | Existing Alt+Up/Down |
| Go To All | Ctrl+N | Ctrl+K, Ctrl+N |
| Go to file (`f ` search) | Ctrl+Shift+N | Ctrl+K, Ctrl+F |
| Go to symbol (`# ` search) | Ctrl+Alt+Shift+N | Ctrl+K, Ctrl+S |
| Go to member (`m ` search) | Ctrl+F12 | Ctrl+K, Ctrl+M |
| Recent files (`recent ` search) | Ctrl+E | Ctrl+K, Ctrl+E |
| Go to definition | Ctrl+B | Ctrl+K, Ctrl+B |
| Find references | Alt+F7 | — |
| Next/previous diagnostic | F12 / Shift+F12 | — |
| Command search | Ctrl+Shift+A | — |
| Rename | F2 | — |
| Request Extract Method action | Ctrl+Alt+M | — |
| Options | — | Ctrl+K, Ctrl+, |

Common navigation, clipboard, undo/redo, find/replace, save, build, and debugger
bindings remain available. Ctrl+Y retains SharpForge's existing Redo contract.
All editing gestures use the current model and its operation history. Language
features use the registered SharpForge provider; unavailable snippets produce an
explicit status message. Ctrl+Shift+R opens the available action list, and does
not imply that every JetBrains refactoring exists.

Studio projects supported workspace commands into Global scope and retains their
query arguments. Projection occurs when the profile table is installed, through
the existing indexed resolver; it adds no source-text work to key handling.
Duplicate common app shortcuts are listed once, with the profile priority.
Changing profiles cancels pending chords in both resolvers.

Browsers or the operating system may reserve some reference gestures before a
web editor receives them. The explicit chords use the same command identities
and arguments. Physical browser delivery, keyboard layouts, and a running
JetBrains instance require separate platform qualification.

## Reference and qualification

The mapping was checked against JetBrains' official
[ReSharper 2026.2 shortcut reference](https://www.jetbrains.com/help/resharper/Reference__Keyboard_Shortcuts.html)
(updated 7 August 2026) and its
[IntelliJ-scheme reference card](https://www.jetbrains.com/resharper/docs/ReSharper_DefaultKeymap_IDEAscheme.pdf).
The table records gesture correspondence to SharpForge's existing commands;
it does not assert full JetBrains feature or selection-behavior parity.

The complete implementation, tests, and documentation are authored before the
focused validation batch. New coverage lives in
`tests/a20-resharper-keymap.test.js` and `tests/a19-first-run-schemes.test.js`.
The control fixture exercises real event listeners, SettingsStore, Options,
shell settings subscription, native EditorModel/editing, StudioKeyboard,
host-command routing, and search filtering, with the DOM and language-provider
edges explicit. It is not a rendered-browser or native-OS run.

Run the completed scope through the machine-wide limiter:

```sh
node scripts/limited.js node --test --test-reporter=spec \
  tests/a19-first-run-schemes.test.js tests/a20-resharper-keymap.test.js \
  tests/a19-studio-keyboard.test.js tests/a19-shell-settings.test.js
```

Qualification completed on Node v24.19.0, Linux x64: all 27 new cases passed;
the completed scope has 48 distinct eventual passes and no skipped tests. An
existing Emacs binding-count expectation was updated to assert both global save
gestures and actual invocation after projection; its 10-case regression file then
passed in full. The editor public-API smoke and all three exported integration
steps passed. The initial stylesheet smoke was corrected to follow the entry
file's bundled CSS imports. Detailed commands and limits are recorded in
`docs/project16-text-native-evidence.md`.
